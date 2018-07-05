const { Node, NodeHeap } = require('./node');
const { gather_dict, len } = require('./utils');
const { logger } = require('../logger');

/**
 * Crawl the network and look for given 160-bit keys.
 */
class SpiderCrawl {
    constructor(protocol, node, peers, ksize, alpha, gateways) {
        // Create a new C{SpiderCrawl}er.

        // Args:
        //     protocol: A :class:`~kademlia.protocol.KademliaProtocol` instance.
        //     node: A :class:`~kademlia.node.Node` representing the key we're
        //           looking for
        //     peers: A list of :class:`~kademlia.node.Node` instances that
        //            provide the entry point for the network
        //     ksize: The value for k based on the paper
        //     alpha: The value for alpha based on the paper

        this.protocol = protocol;
        this.ksize = ksize;
        this.alpha = alpha;
        this.node = node;
        this.nearest = new NodeHeap(this.node, this.ksize);
        this.lastIDsCrawled = '';
        this.gateways = gateways || new Map;

        logger.info("creating spider with peers: %d", len(peers));
        this.nearest.push(peers);
    }

    async _find(rpcmethod) {
        // Get either a value or list of nodes.

        // Args:
        //     rpcmethod: The protocol's callfindValue or callFindNode.

        // The process:
        //   1. calls find_* to current ALPHA nearest not already queried nodes,
        //      adding results to current nearest list of k nodes.
        //   2. current nearest list needs to keep track of who has been queried
        //      already sort by nearest, keep KSIZE
        //   3. if list is same as last time, next call should be to everyone not
        //      yet queried
        //   4. repeat, unless nearest list has all been queried, then ur done

        logger.info("crawling network with nearest: %d", this.nearest.len);

        let count = this.alpha;
        let nears = this.nearest.getIDs().join('');
        let crawl = this.lastIDsCrawled;

        if (nears === crawl) {
            count = nears.length;
        }
        this.lastIDsCrawled = nears;

        let ds = new Map;
        let uc = this.nearest.getUncontacted().slice(0, count);

        // NAT Passthrough
        await this._stun(uc);

        for (let peer of uc) {
            ds.set(peer.id, rpcmethod(peer, this.node));
            this.nearest.markContacted(peer);
        }

        let found = await gather_dict(ds);
        return await this._nodesFound(found);
    }

    async _nodesFound(responses) {
        throw new Error('NotImplementedError');
    }

    async _stun(peers) {
        if (len(peers) > this.alpha) {
            logger.warn('not yet queried peer is %d', len(peers));
        }

        let stuns = this.gateways;
        let holes = [];

        for (let [ , ip, port ] of peers) {
            if (!stuns.has(`${ip}:${port}`)) {
                holes.push([ ip, port ]);
            }
        }

        let ds = [];
        for (let stun of stuns.values()) {
            ds.push(this.protocol.stun(stun, holes));
        }

        return Promise.all(ds);
    }
}

class ValueSpiderCrawl extends SpiderCrawl {
    constructor(protocol, node, peers, ksize, alpha, gateways) {
        super(protocol, node, peers, ksize, alpha, gateways);

        // keep track of the single nearest node without value - per
        // section 2.3 so we can set the key there if found
        this.nearestWithoutValue = new NodeHeap(this.node, 1);
    }

    async find() {
        // Find either the closest nodes or the value requested.
        let that = this.protocol;
        return await this._find(that.callFindValue.bind(that));
    }

    // Handle the result of an iteration in _find.
    async _nodesFound(responses) {
        let toremove = [];
        let foundValues = [];

        for (let [ peerid, response ] of responses) {
            response = new RPCFindResponse(response)
            if (!response.happened()) {
                toremove.push(peerid);
            }
            else if (response.hasValue()) {
                foundValues.push(response.getValue());
            }
            else {
                let peer = this.nearest.getNodeById(peerid);
                this.nearestWithoutValue.push(peer);
                this.nearest.push(response.getNodeList());
            }
        }

        this.nearest.remove(toremove);

        if (len(foundValues) > 0) {
            return await this._handleFoundValues(foundValues);
        }

        if (this.nearest.allBeenContacted()) {
            return null;
        }

        return await this.find();
    }

    async _handleFoundValues(values) {
        // We got some values!  Exciting.  But let's make sure
        // they're all the same or freak out a little bit.  Also,
        // make sure we tell the nearest node that *didn't* have
        // the value to store it.

        let most_common = [ undefined, 0 ];
        let counter = new Map;

        values.forEach(val => {
            let key = JSON.stringify(val);
            let cnt = (counter.get(key) || 0) + 1;
            let [ , max ] = most_common;

            counter.set(key, cnt);
            if (cnt > max) {
                most_common = [ val, cnt ];
            }
        });

        if (counter.size != 1) {
            logger.warn("Got multiple values for key %s: %O", this.node.id, values);
        }

        let value = most_common[0];
        let peerToSaveTo = this.nearestWithoutValue.popleft();
        if (peerToSaveTo !== null) {
            await this.protocol.callStore(peerToSaveTo, this.node.id, value);
        }
        return value;
    }
}

class NodeSpiderCrawl extends SpiderCrawl {
    async find() {
        // Find the closest nodes.
        let that = this.protocol;
        return await this._find(that.callFindNode.bind(that));
    }

    // Handle the result of an iteration in _find.
    async _nodesFound(responses) {
        let toremove = [];
        for (let [ peerid, response ] of responses) {
            response = new RPCFindResponse(response);
            if (!response.happened()) {
                toremove.push(peerid);
            }
            else {
                this.nearest.push(response.getNodeList());
            }
        }

        this.nearest.remove(toremove);
        if (this.nearest.allBeenContacted()) {
            return Array.from(this.nearest);
        }

        return await this.find();
    }
}

class RPCFindResponse {
    constructor(response) {
        // A wrapper for the result of a RPC find.

        // Args:
        //     response: This will be a tuple of (<response received>, <value>)
        //               where <value> will be a list of tuples if not found or
        //               a dictionary of {'value': v} where v is the value desired
        this.response = response;
    }

    happened() {
        // Did the other host actually respond?
        return this.response[0];
    }

    hasValue() {
        return this.response[1] && !!this.response[1]['value'];
    }

    getValue() {
        return this.response[1]['value'];
    }

    getNodeList() {
        // Get the node list in the response.  If there's no value, this should
        // be set.
        let nodelist = this.response[1] || [];
        return nodelist.map(([ id, ip, port ]) => {
            return new Node(id, ip, port);
        });
    }
}

module.exports = {
    ValueSpiderCrawl,
    NodeSpiderCrawl,
    RPCFindResponse
};
