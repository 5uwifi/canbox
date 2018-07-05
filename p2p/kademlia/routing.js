const heapq = require('heap');
const { BigNumber: BN } = require('bignumber.js');
const { now, len, compare, OrderedSet, sharedPrefix, bytesToBitString } = require('./utils');
const { logger } = require('../logger');

class KBucket {
    constructor(rangeLower, rangeUpper, ksize) {
        this.range = [ rangeLower, rangeUpper ];
        this.nodes = new Map;
        this.replacementNodes = new OrderedSet;
        this.touchLastUpdated();
        this.ksize = ksize;
    }

    touchLastUpdated() {
        this.lastUpdated = now();
    }

    getNodes() {
        return Array.from(this.nodes.values());
    }

    split() {
        let [ min, max ] = this.range;
        let midpoint = min.plus(max).div(2);
        let ksz = this.ksize;

        let one = new KBucket(min, midpoint, ksz);
        let two = new KBucket(midpoint.plus(1), max, ksz);

        for (let node of this.nodes.values()) {
            let { id } = node;

            if (midpoint.gt(id, 16)) {
                one.nodes.set(id, node);
            }
            else {
                two.nodes.set(id, node);
            }
        }

        return [ one, two ];
    }

    removeNode(node) {
        if (!this.nodes.has(node.id)) {
            return;
        }

        // delete node, and see if we can add a replacement
        this.nodes.delete(node.id);

        if (len(this.replacementNodes)) {
            let newnode = this.replacementNodes.pop();
            this.nodes.set(newnode.id, newnode);
        }
    }

    hasInRange(node) {
        let [ min, max ] = this.range;
        let id = BN(node.id, 16);

        return id.gte(min) && id.lte(max);
    }

    isNewNode(node) {
        return !this.nodes.has(node.id);
    }

    addNode(node) {
        /**
         * Add a C{Node} to the C{KBucket}.  Return True if successful,
         * False if the bucket is full.
         *
         * If the bucket is full, keep track of node in a replacement list,
         * per section 4.1 of the paper.
         */

        let nodes = this.nodes;
        let id = node.id;

        if (nodes.has(id)) {
            nodes.delete(id);
            nodes.set(id, node);
        }
        else if (this.len < this.ksize) {
            nodes.set(id, node);
        }
        else {
            this.replacementNodes.push(node);
            return false;
        }

        return true;
    }

    depth() {
        let keys = Array.from(this.nodes.keys());
        let bits = keys.map(id => bytesToBitString(id));

        return len(sharedPrefix(bits));
    }

    head() {
        return this.getNodes()[0];
    }

    get(node_id, def = null) {
        if (this.node.has(node_id)) {
            return this.nodes.get(node_id);
        }
        return def;
    }

    get len() {
        return this.nodes.size;
    }
}

class TableTraverser {
    constructor(table, startNode) {
        let index = table.getBucketFor(startNode);
        let buckets = table.buckets;

        buckets[index].touchLastUpdated();

        this.currentNodes = buckets[index].getNodes();
        this.leftBuckets = buckets.slice(0, index);
        this.rightBuckets = buckets.slice(index + 1);
        this.left = true;
    }

    [Symbol.iterator]() {
        const gen = {
            next: () => {
                if (this.currentNodes.length) {
                    return { "value": this.currentNodes.pop(), "done": false };
                }

                if (this.left && this.leftBuckets.length) {
                    this.currentNodes = this.leftBuckets.pop().getNodes();
                    this.left = false;
                    return gen.next();
                }

                if (this.rightBuckets.length) {
                    this.currentNodes = this.rightBuckets.pop().getNodes();
                    this.left = true;
                    return gen.next();
                }

                return { "done": true };
            }
        };
        return gen;
    }
}

class RoutingTable {
    constructor(protocol, ksize, node) {
        /**
         * @param node: The node that represents this server.  It won't
         * be added to the routing table, but will be needed later to
         * determine which buckets to split or not.
         */
        this.node = node;
        this.protocol = protocol;
        this.ksize = ksize;
        this.flush();
    }

    flush() {
        this.buckets = [ new KBucket(BN(0), BN(2).pow(160), this.ksize) ];
    }

    splitBucket(index) {
        let [ one, two ] = this.buckets[index].split();
        this.buckets[index] = one;
        this.buckets.splice(index + 1, 0, two);
    }

    getLonelyBuckets() {
        // Get all of the buckets that haven't been updated in over
        // an hour.
        let hrago = now() - 3600000;
        return this.buckets.filter(b => {
            return b.lastUpdated < hrago;
        });
    }

    removeContact(node) {
        let index = this.getBucketFor(node);
        this.buckets[index].removeNode(node);
    }

    isNewNode(node) {
        let index = this.getBucketFor(node);
        return this.buckets[index].isNewNode(node);
    }

    addContact(node) {
        let index = this.getBucketFor(node);
        let bucket = this.buckets[index];

        // this will succeed unless the bucket is full
        if (bucket.addNode(node)) {
            return;
        }

        // Per section 4.2 of paper, split if the bucket has the node
        // in its range or if the depth is not congruent to 0 mod 5
        let rng = bucket.hasInRange(this.node);
        let mod = bucket.depth() % 5 != 0;
        logger.debug('Node in Bucket range: %s, depth is not congruent to 0 mod 5: %s', rng, mod);

        if (rng || mod) {
            this.splitBucket(index);
            this.addContact(node);
        }
        else {
            this.protocol.callPing(bucket.head());
        }
    }

    getBucketFor(node) {
        // Get the index of the bucket that the given node would fall into.
        for (let [ index, { range: [ , max ] } ] of this.buckets.entries()) {
            if (max.gte(node.id, 16)) {
                return index;
            }
        }
    }

    findNeighbors(node, k = null, exclude = null) {
        k = k || this.ksize;
        let nodes = [];
        let table = new TableTraverser(this, node);

        for (let neighbor of table) {
            let notexcluded = exclude === null || !neighbor.sameHomeAs(exclude);
            if (neighbor.id !== node.id && notexcluded) {
                heapq.push(nodes, [ node.distanceTo(neighbor), neighbor ]);
            }
            if (len(nodes) == k) {
                break;
            }
        }

        return heapq.nsmallest(nodes, k, compare).map(([ _, node ]) => {
            return node;
        });
    }
}

module.exports = {
    KBucket,
    TableTraverser,
    RoutingTable
};
