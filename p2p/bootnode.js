const { Server } = require('./kademlia/network');
const { logger } = require('./logger');

class App {
    constructor() {
        this.node = new Server(8);
        this.init();
    }

    async init() {
        try {
            // Genesis
            let ok = await this.node.listen(13001);
            logger.info('bootstrap %s', ok);
        } catch (err) {
            this.node.stop();
        }
    }
}

new App;
