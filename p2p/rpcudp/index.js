const { randomBytes, createHash } = require('crypto');
const { format } = require('util');
const { encode, decode, register } = require('msgpack5')();
const { logger } = require('../logger');

class MalformedMessage extends Error {
}

class RPCProtocol {
    /**
     * @param { Number } waitTimeout:
     *  Consider it a connetion failure if no response
     *  within this time window.
     */
    constructor(waitTimeout = 5000) {
        this._waitTimeout = waitTimeout;
        this._outstanding = new Map;
        this.transport = null;
    }

    connection_made(transport) {
        this.transport = transport;
    }

    datagram_received(data, addr) {
        let { address, port } = addr;
        logger.debug("received datagram from %s:%d", address, port);

        this._solveDatagram(data, [ address, port ]);
    }

    _solveDatagram(datagram, address) {
        if (datagram.length < 22) {
            logger.warn("received datagram too small from %s, ignoring", address.join(':'));
            return;
        }

        let method = datagram.slice(0, 1).toString('hex');
        let msgid = datagram.slice(1, 21);
        let data = decode(datagram.slice(21));

        if (method == 0x00) {
            // schedule accepting request and returning the result
            this._acceptRequest(msgid, data, address).catch(err => {
                logger.error('Could not read packet: %O', err);
            });
        }
        else if (method == 0x01) {
            this._acceptResponse(msgid, data, address);
        }
        else {
            // otherwise, don't know the format, don't do anything
            logger.debug("Received unknown message from %O, ignoring", address);
        }
    }

    _acceptResponse(msgid, data, address) {
        msgid = msgid.toString('base64');
        if (!this._outstanding.has(msgid)) {
            logger.warn("received unknown message %s from %s; %s ignoring", msgid, address.join(':'), data);
            return;
        }
        logger.debug("received response %s for message id %s from %s", data, msgid, address.join(':'));

        let [ f, timeout ] = this._outstanding.get(msgid);
        clearTimeout(timeout);
        f.resolve([ true, data ]);
        this._outstanding.delete(msgid);
    }

    async _acceptRequest(msgid, data, address) {
        if (!Array.isArray(data) || data.length != 2) {
            throw new MalformedMessage(format("Could not read packet: %O", data));
        }

        let [ host, port ] = address;
        let [ fname, args ] = data;
        let f = this[`rpc_${fname}`] || null;

        if (f === null) {
            logger.warn("RPCProtocol has no callable method rpc_%s; ignoring request", fname);
            return;
        }

        let response = await f.apply(this, [ address, ...args ]);
        logger.debug("sending response %O for msg id %s to %s:%d", response, msgid.toString('base64'), host, port);

        let method = Buffer.from('01', 'hex');
        let answer = Buffer.concat([ method, msgid, encode(response) ]);
        this.transport.send(answer, port, host, () => {
            logger.debug("sending response done");
        });
    }

    _timeout(msgid, action, port, ip) {
        let [ f ] = this._outstanding.get(msgid);
        logger.warn("Did not received reply for msgid %s from [%s:%s:%d] within %i millisecond",
            msgid, action, ip, port, this._waitTimeout);

        f.resolve([ false, null ]);
        this._outstanding.delete(msgid);
    }

    find_node(...args) {
        return this.rpc('find_node', ...args);
    }

    find_value(...args) {
        return this.rpc('find_value', ...args);
    }

    ping(...args) {
        return this.rpc('ping', ...args);
    }

    store(...args) {
        return this.rpc('store', ...args);
    }

    stun(...args) {
        return this.rpc('stun', ...args);
    }

    punch(...args) {
        return this.rpc('punch', ...args);
    }

    hole(...args) {
        return this.rpc('hole', ...args);
    }

    rpc(name, address, ...args) {
        // If name begins with "_" or "rpc_", returns the value of
        // the attribute in question as normal.
        // Otherwise, returns the value as normal *if* the attribute
        // exists, but does *not* raise AttributeError if it doesn't.
        // Instead, returns a closure, func, which takes an argument
        // "address" and additional arbitrary args (but not kwargs).
        // func attempts to call a remote method "rpc_{name}",
        // passing those args, on a node reachable at address.

        let [ ip, port ] = address;
        let method = Buffer.from('00', 'hex');
        let msgid = createHash('sha1').update(randomBytes(20)).digest();
        let data = Buffer.concat([ method, msgid, encode([ name, args ]) ]);

        if (data.length > 512) {
            throw MalformedMessage("Total length of function name and arguments cannot exceed 576Bytes");
        }

        let f = (() => {
            let d = Object.create({});
            let p = new Promise((resolve, reject) => {
                d.resolve = resolve;
            });
            return Object.assign(p, d);
        })();

        // buffer to string
        let btos = msgid.toString('base64');
        let tick = this._timeout.bind(this);
        let wait = this._waitTimeout;
        let timeout = setTimeout(tick, wait, btos, name, port, ip);

        this.transport.send(data, port, ip, () => {
            logger.debug("calling remote function %s on %s (msgid %s)",
                      name, address.join(':'), btos);
            this._outstanding.set(btos, [ f, timeout ]);
        });

        return f;
    }
}

module.exports = {
    RPCProtocol
};
