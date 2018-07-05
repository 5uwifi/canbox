const { Server } = require('./kademlia/network');
const { logger } = require('./logger');

class App {
    constructor(SN, interval = 20000, debug = "hello world") {
        if (!SN) {
            logger.error('Device SN is NULL');
            process.exit(0);
        }

        this.SN = SN;
        this.interval = interval;
        this.debug = debug;

        this.node = new Server(8);
        this.timer = null;

        this.init();
    }

    stop() {
        node.stop();
        if (this.timer) {
            clearTimeout(this.timer);
        }
    }

    async init() {
        try {
            let ok = await this.node.listen(13001);
            logger.info('node init %s', ok);

            let router = await this.node.bootstrap([[ '39.104.66.16', 13001 ]]);
            logger.info('node neighbors: %j', router);

            this.keepalive();
        } catch (err) {
            logger.error(err);
            this.stop();
        }
    }

    async keepalive() {
        let key = this.SN;
        let val = Buffer.from(this.debug);

        await this.node.set(key, val).catch(err => {
            logger.error(err);
        });

        let f = this.keepalive.bind(this);
        this.timer = setTimeout(f, this.interval);
    }
}

new App(...process.argv.slice(2));
