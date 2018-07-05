const { createHash } = require('crypto');
const { logger } = require('../logger');

/**
 * Acts like a list in all ways, except in the behavior of the
 * :meth:`push` method.
 */
class OrderedSet extends Map {
    key(thing) {
        return JSON.stringify(thing);
    }

    has(thing) {
        return super.has(this.key(thing));
    }

    set(thing) {
        super.set(this.key(thing), thing);
        return this;
    }

    delete(thing) {
        super.delete(this.key(thing));
    }

    push(thing) {
        // 1. If the item exists in the list, it's removed
        // 2. The item is pushed to the end of the list

        if (this.has(thing)) {
            this.delete(thing);
        }

        return this.set(thing);
    }

    pop() {
        let size = this.size;
        if (size) {
            let key = Array.from(this.keys()).pop();
            let ret = this.get(key);

            super.delete(key);
            return ret;
        }

        return null;
    }
}

function digest(s, encoding = 'hex') {
    return new createHash('sha1').update(s).digest(encoding);
}

function now() {
    return Date.now();
}

function len(o) {
    if (typeof o === 'string' || Array.isArray(o)) {
        return o.length;
    }
    return o.size;
}

function compare(a, b) {
    let [ x ] = a;
    let [ y ] = b;

    if (x.lt(y)) {
        return -1;
    }

    if (x.gt(y)) {
        return 1;
    }

    return 0;
}

function sharedPrefix(args) {
    // Find the shared prefix between the strings.

    // For instance:

    //     sharedPrefix(['blahblah', 'blahwhat'])

    // returns 'blah'.

    let i = 0;
    let min = Math.min.apply(null, args.map(len));

    while (i < min) {
        if (len(new Set(args.map(v => v[i]))) !== 1)
            break;
        i += 1;
    }

    return args[0].substring(0, i);
}

function bytesToBitString(bites, encoding = 'hex') {
    return Array.from(Buffer.from(bites, encoding)).map(bite => {
        return ('00000000' + bite.toString(2)).slice(-8);
    }).join('');
}

/**
 * @param  {Map} defers
 */
function gather_dict(defers) {
    defers = Array.from(defers.entries()).map(([ key, defer ]) => {
        return defer.then(val => {
            return [ key, val ];
        }).catch(err => {
            return [ key, err ];
        });
    });

    return Promise.all(defers);
}

module.exports = {
    gather_dict,
    sharedPrefix,
    len,
    now,
    compare,
    digest,
    OrderedSet,
    bytesToBitString
};
