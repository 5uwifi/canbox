const { BigNumber: BN, random } = require('bignumber.js');
const { RoutingTable } = require('./routing');
const { Node } = require('./node');
const { len, digest } = require('./utils');
const { RPCProtocol } = require('../rpcudp');
const { logger } = require('../logger');

// HASH
const BIT_EMPTY = '0000000000000000000000000000000000000000';
const BIT_SPACE = 40;

class KademliaProtocol extends RPCProtocol {
    constructor(sourceNode, storage, ksize) {
        super();
        this.router = new RoutingTable(this, ksize, sourceNode);
        this.storage = storage;
        this.sourceNode = sourceNode;
    }

    // Get ids to search for to keep old buckets up to date.
    getRefreshIDs() {
        let buckets = this.router.getLonelyBuckets();
        return buckets.map(({ range: [ min, max ]}) => {
            let sub = max.minus(min);
            let rnd = random();
            let num = sub.times(rnd).plus(sub).integerValue();
            let hex = num.toString(16);
            return ( BIT_EMPTY + hex ).slice(BIT_SPACE * -1);
        });
    }

    rpc_stun(sender, peers) {
        for (let peer of peers) {
            this.punch(peer, sender);
        }
        return sender;
    }

    rpc_punch(_, peer) {
        this.hole(peer, this.sourceNode.id);
        return 'hole';
    }

    rpc_hole() {
        return this.sourceNode.id;
    }

    rpc_ping(sender, nodeid) {
        let [ ip, port ] = sender;
        let source = new Node(nodeid, ip, port);

        this.welcomeIfNewNode(source);
        return this.sourceNode.id;
    }

    rpc_store(sender, nodeid, key, value) {
        let [ ip, port ] = sender;
        let source = new Node(nodeid, ip, port);

        this.welcomeIfNewNode(source);

        logger.debug("got a store request from %s, storing '%s'='%s'",
            sender.join(':'), key, value);
        this.storage.set(key, value);

        return true;
    }

    rpc_find_node(sender, nodeid, key) {
        logger.info("finding neighbors of [%s] in local table", nodeid);

        let [ ip, port ] = sender;
        let source = new Node(nodeid, ip, port);
        this.welcomeIfNewNode(source);

        let node = new Node(key);
        let neighbors = this.router.findNeighbors(node, null, source);

        return neighbors.map(([ id, ip, port ]) => {
            return [ id, ip, port ];
        });
    }

    rpc_find_value(sender, nodeid, key) {
        let source = new Node(nodeid, sender[0], sender[1]);
        this.welcomeIfNewNode(source);

        let value = this.storage.get(key, null);
        if (value === null) {
            return this.rpc_find_node(sender, nodeid, key);
        }

        return { "value": value };
    }

    async callFindNode(nodeToAsk, nodeToFind) {
        let address = [ nodeToAsk.ip, nodeToAsk.port ];
        let sid = this.sourceNode.id;
        let fid = nodeToFind.id;
        let result = await this.find_node(address, sid, fid);
        return this.handleCallResponse(result, nodeToAsk);
    }

    async callFindValue(nodeToAsk, nodeToFind) {
        let address = [ nodeToAsk.ip, nodeToAsk.port ];
        let sid = this.sourceNode.id;
        let fid = nodeToFind.id;
        let result = await this.find_value(address, sid, fid);
        return this.handleCallResponse(result, nodeToAsk);
    }

    async callPing(nodeToAsk) {
        let address = [ nodeToAsk.ip, nodeToAsk.port ];
        let result = await this.ping(address, this.sourceNode.id);
        return this.handleCallResponse(result, nodeToAsk);
    }

    async callStore(nodeToAsk, key, value) {
        let address = [ nodeToAsk.ip, nodeToAsk.port ];
        let sid = this.sourceNode.id;
        let result = await this.store(address, sid, key, value);
        return this.handleCallResponse(result, nodeToAsk);
    }

    // Given a new node, send it all the keys/values it should be storing,
    // then add it to the routing table.

    // @param node: A new node that just joined (or that we just found out
    // about).

    // Process:
    // For each key in storage, get k closest nodes.  If newnode is closer
    // than the furtherst in that list, and the node for this server
    // is closer than the closest in that list, then store the key/value
    // on the new node (per section 2.5 of the paper)
    welcomeIfNewNode(node) {
        if (!this.router.isNewNode(node)) {
            return;
        }

        logger.info("never seen %s before, adding to router", node);

        let storages = this.storage.items();
        for (let [ key, value ] of storages) {
            let keynode = new Node(digest(key));
            let neighbors = this.router.findNeighbors(keynode);

            let newNodeClose = false;
            let thisNodeClosest = false;
            let l = len(neighbors);

            if (l > 0) {
                let last = neighbors[ l - 1 ].distanceTo(keynode);
                newNodeClose = node.distanceTo(keynode).lt(last);

                let first = neighbors[0].distanceTo(keynode);
                thisNodeClosest = this.sourceNode.distanceTo(keynode).lt(first);
            }

            if (l === 0 || (newNodeClose && thisNodeClosest)) {
                this.callStore(node, key, value);
            }
        }
        this.router.addContact(node);
    }

    /**
     * If we get a response, add the node to the routing table.  If
     * we get no response, make sure it's removed from the routing table.
     */
    handleCallResponse(result, node) {
        if (!result[0]) {
            logger.warn("no response from %s, removing from router", node);
            this.router.removeContact(node);
            return result;
        }

        logger.info("got successful response from %s", node)
        this.welcomeIfNewNode(node);
        return result
    }
}

module.exports = {
    KademliaProtocol
};
