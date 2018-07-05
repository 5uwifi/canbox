const heapq = require('heap');
const BN = require('bignumber.js');
const { len, compare } = require('./utils');
const { logger } = require('../logger');

class Node {
    constructor(node_id, ip = null, port = null) {
        this.id = node_id;
        this.ip = ip;
        this.port = port;
        this.long_id = Buffer.from(node_id, 'hex');
    }

    sameHomeAs(node){
        return this.ip == node.ip && this.port == node.port;
    }

    // Get the distance between this node and another.
    distanceTo(node) {
        let a = this.long_id;
        let b = node.long_id;

        let sz = a.length;
        let buf = Buffer.alloc(sz, 0);

        for (let i = 0; i < sz; i++) {
            buf[i] = a[i] ^ b[i];
        }

        return new BN(buf.toString('hex'), 16);
    }

    // Enables use of Node as a tuple - i.e., tuple(node) works.
    * [Symbol.iterator]() {
        yield this.id;
        yield this.ip;
        yield this.port;
    }

    toJSON() {
        return [ this.id, this.ip, this.port ];
    }

    toString() {
        return `${this.id} ${this.ip}:${this.port}`;
    }
}

/**
 * A heap of nodes ordered by distance to a given node.
 */
class NodeHeap {
    /**
     * @param  {Node}   node    The node to measure all distnaces from
     * @param  {Number} maxsize The maximum size that this heap can grow to
     */
    constructor(node, maxsize) {
        this.node = node;
        this.heap = [];
        this.contacted = new Set();
        this.maxsize = maxsize;
    }

    remove(peerIDs) {
        // Remove a list of peer ids from this heap.  Note that while this
        // heap retains a constant visible size (based on the iterator), it's
        // actual size may be quite a bit larger than what's exposed.  Therefore,
        // removal of nodes may not change the visible size as previously added
        // nodes suddenly become visible.

        peerIDs = new Set(peerIDs);
        if (len(peerIDs) == 0) {
            return;
        }

        let nheap = [];
        for (let [ distance, node ] of this.heap) {
            if (!peerIDs.has(node.id)) {
                heapq.push(nheap, [ distance, node ], compare);
            }
        }
        this.heap = nheap;
    }

    getNodeById(node_id) {
        for (let [ _, node ] of this.heap) {
            if (node.id == node_id) {
                return node;
            }
        }
        return null;
    }

    allBeenContacted() {
        return len(this.getUncontacted()) === 0;
    }

    getIDs() {
        return Array.from(this).map(n => n.id);
    }

    markContacted(node) {
        this.contacted.add(node.id);
    }

    popleft() {
        if (this.len > 0) {
            return heapq.pop(this.heap)[1];
        }
        return null;
    }

    push(nodes) {
        if (!Array.isArray(nodes)) {
            nodes = [ nodes ];
        }

        for (let node of nodes) {
            if (!this.has(node)) {
                let distance = this.node.distanceTo(node);
                heapq.push(this.heap, [ distance, node ], compare);
            }
        }
    }

    * [Symbol.iterator]() {
        let size = this.maxsize;
        let heap = this.heap.concat([]);

        for (let [ _, node ] of heapq.nsmallest(heap, size, compare)) {
            yield node;
        }
    }

    get len() {
        return Math.min(len(this.heap), this.maxsize);
    }

    has(node) {
        for (let [ , n ] of this.heap) {
            if (node.id === n.id) {
                return true;
            }
        }
        return false;
    }

    getUncontacted() {
        return Array.from(this).filter(n => {
            return !this.contacted.has(n.id);
        }, this);
    }
}

module.exports = {
    Node,
    NodeHeap
};
