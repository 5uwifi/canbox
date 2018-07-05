/**
 * Package for interacting on the network at a high level.
 */

const { createSocket } = require('dgram');
const { randomBytes } = require('crypto');
const { max } = require('bignumber.js');
const { KademliaProtocol } = require('./protocol');
const { digest, len } = require('./utils');
const { ForgetfulStorage } = require('./storage');
const { Node } = require('./node');
const { ValueSpiderCrawl, NodeSpiderCrawl } = require('./crawling');
const { logger } = require('../logger');

const PERIOD_HOUR = 3600 * 100;

/**
 * High level view of a node instance.  This is the object that should be
 * created to start listening as an active node on the network.
 */
class Server {
    constructor(ksize = 20, alpha = 3, node_id = null, storage = null) {
        // Create a server instance.  This will start listening on the given port.

        // Args:
        //     ksize (int): The k parameter from the paper
        //     alpha (int): The alpha parameter from the paper
        //     node_id: The id for this node on the network.
        //     storage: An instance that implements
        //              :interface:`~kademlia.storage.IStorage`

        this.ksize = ksize;
        this.alpha = alpha;
        this.storage = storage || new ForgetfulStorage;
        this.node = new Node(node_id || digest(randomBytes(255)));
        this.transport = null;
        this.protocol = null;
        this.refresh_loop = null;
    }

    stop() {
        if (this.transport) {
            this.transport.close();
        }

        if (this.refresh_loop) {
            clearTimeout(this.refresh_loop);
        }
    }

    listen(port, host = '0.0.0.0') {
        // Start listening on the given port.
        //
        // Provide host="::" to accept ipv6 address

        let transport = createSocket('udp4');
        let protocol = new KademliaProtocol(this.node, this.storage, this.ksize);

        this.transport = transport;
        this.protocol = protocol;

        let datagram_received = protocol.datagram_received.bind(protocol);
        protocol.connection_made(transport);
        transport.on('message', datagram_received);
        transport.once('close', () => {
            logger.warn('Node closed');
        });
        transport.on('error', (err) => {
            logger.error("Node error: %O", err);
        });

        return new Promise((resolve, reject) => {
            transport.bind(port, host, () => {
                logger.info("Node [%s] listening on %s:%d", this.node.id, host, port);

                // finally, schedule refreshing table
                this.refresh_table().then(() => {
                    resolve('ok');
                }).catch(err => {
                    reject(err);
                });
            });
        });
    }

    async refresh_table() {
        logger.debug("Refreshing routing table");

        clearTimeout(this.refresh_loop);
        this.refresh_loop = setTimeout(() => {
            this.refresh_table();
        }, PERIOD_HOUR);

        return this._refresh_table();
    }

    async _refresh_table() {
        // Refresh buckets that haven't had any lookups in the last hour
        // (per section 2.3 of the paper).

        let ds = [];
        for (let node_id of this.protocol.getRefreshIDs()) {
            let node = new Node(node_id);
            let nearest = this.protocol.router.findNeighbors(node, this.alpha);
            let spider = new NodeSpiderCrawl(this.protocol, node, nearest, this.ksize, this.alpha, this.gateways);
            ds.push(spider.find());
        }

        // do our crawling
        await Promise.all(ds);

        // now republish keys older than one hour
        for (let [ dkey, value ] of this.storage.iteritemsOlderThan(PERIOD_HOUR)) {
            await this.set_digest(dkey, value);
        }
    }

    async bootstrap(addrs) {
        // Bootstrap the server by connecting to other known nodes in the network.

        // Args:
        //     addrs: A `list` of (ip, port) `tuple` pairs.  Note that only IP
        //            addresses are acceptable - hostnames will cause an error.

        logger.debug("Attempting to bootstrap node with %i initial contacts", len(addrs));

        let gateways = new Map;
        for (let [ ip, port ] of addrs) {
            gateways.set(`${ip}:${port}`, [ ip, port ]);
        }
        this.gateways = gateways;

        let cos = addrs.map(addr => this.bootstrap_node(addr), this);
        let gathered = await Promise.all(cos);

        let nodes = gathered.filter(node => node !== null);
        let spider = new NodeSpiderCrawl(this.protocol, this.node, nodes, this.ksize, this.alpha, this.gateways);
        return await spider.find();
    }

    async bootstrap_node(addr) {
        let [ ok, id ] = await this.protocol.ping(addr, this.node.id);
        let [ ip, port ] = addr;
        if (ok) {
            return new Node(id, ip, port);
        }
        return null;
    }

    async get(key) {
        // Get a key if the network has it.

        // Returns:
        //     :class:`None` if not found, the value otherwise.

        logger.info("Looking up key %s", key);
        let dkey = digest(key);
        // if this node has it, return it
        if (this.storage.get(dkey)) {
            return this.storage.get(dkey);
        }
        let node = new Node(dkey);
        let nearest = this.protocol.router.findNeighbors(node);

        if (nearest.length === 0) {
            logger.warn("There are no known neighbors to get key %s", key);
            return null;
        }
        let spider = new ValueSpiderCrawl(this.protocol, node, nearest, this.ksize, this.alpha, this.gateways);
        return await spider.find();
    }

    async set(key, value) {
        // Set the given string key to the given value in the network.

        if (!Buffer.isBuffer(value)) {
            throw new Error("Value must be of type int, float, bool, str, or bytes");
        }
        logger.info("setting '%s' = '%s' on network", key, value);

        let dkey = digest(key);
        return await this.set_digest(dkey, value);
    }

    async set_digest(dkey, value) {
        // Set the given SHA1 digest key (bytes) to the given value in the
        // network.

        let node = new Node(dkey);
        let nearest = this.protocol.router.findNeighbors(node);

        if (nearest.length === 0) {
            logger.warn("There are no known neighbors to set key %s", dkey);
            return false;
        }

        let spider = new NodeSpiderCrawl(this.protocol, node, nearest, this.ksize, this.alpha, this.gateways);
        let nodes = await spider.find();

        logger.info("setting '%s' on %j", dkey, nodes);
        // if this node is close too, then store here as well
        let biggest = max.apply(null, nodes.map(n => n.distanceTo(node)));
        if (this.node.distanceTo(node).lt(biggest)) {
            this.storage.set(dkey, value);
        }

        let ds = nodes.map(n => {
            return this.protocol.callStore(n, dkey, value);
        }, this);

        function any(iter) {
            return Promise.race(iter).then(val => {
                return val;
            }).catch(err => {
                iter.shift();
                return any(iter);
            });
        }

        // return true only if at least one store call succeeded
        return await any(ds);
    }
}

module.exports = {
    Server
};
