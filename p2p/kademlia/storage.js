const { logger } = require('../logger');

/**
 * Local storage for this node
 * IStorage implementations of get must return the same type as put in by set
 */
class IStorage extends Map {
    constructor() {
        super();
    }

    get now() {
        return Date.now();
    }

    set(key, value) {
        if (this.has(key)) {
            this.delete(key);
        }

        super.set(key, [ this.now, value ]);
        this.cull();
    }

    get(key, def = null) {
        this.cull();
        if (this.has(key)) {
            let [ , val ] = (super.get(key) || []);
            return val;
        }

        return def;
    }

    pop(dir = 'FIFO') {
        if (this.size) {
            let idx = dir === 'FIFO' ? 0 : this.size - 1;
            let key = Array.from(this.keys())[idx];
            let ret = (super.get(key) || [])[1];

            this.delete(key);
            return ret;
        }
        return null;
    }

    cull() {
        throw Error('NotImplementedError');
    }
}

class ForgetfulStorage extends IStorage {
    constructor(ttl = 20000) {
        super();
        this.ttl = ttl
    }

    cull() {
        for (let _ of this.iteritemsOlderThan(this.ttl)) {
            this.pop();
        }
    }

    iteritemsOlderThan(secondsOld) {
        let minBirthday = this.now - secondsOld;
        let zipped = this.tripleIterable();
        let matches = zipped.filter(([ , t, ]) => {
            return minBirthday >= t;
        });

        return matches.map(([ k, , v ]) => {
            return [ k, v ];
        });
    }

    tripleIterable() {
        return Array.from(this.entries()).map(([ k, [ t, v ] ]) => {
            return [ k, t, v ];
        });
    }

    items() {
        this.cull();
        return Array.from(this.entries()).map(([ k, [ t, v ] ]) => {
            return [ k, v ];
        });
    }
}

module.exports = {
    IStorage,
    ForgetfulStorage
};
