var cluster = require('cluster');
var expect = require('chai').expect;
var ioServer = require('socket.io');
var ioClient = require('socket.io-client');
var debug = require('debug')('test');

var ClusterStore = require('..')(ioServer);

var serverUrl;

// verify we can call setup without ioServer in master and workers
require('..').setup();

if (cluster.isWorker) {
  startSocketIoServer();
  return;
}


describe('clustered socket.io', function() {
  before(setupWorkers);
  after(stopWorkers);

  describe('server', function() {
    // NOTE(bajtos): There is a bug in socket.io implementation (#952)
    // that makes it impossible to get socket.io working in cluster
    // without session affinity.
    // The following test is exposing this problem and is failing on slower
    // machines.
    it.skip('shares hand-shaken connections', function(done) {
      var client = ioClient.connect(serverUrl, { reconnect: false });
      client.on('error', function(err) { done(err); });
      client.on('connect', function() { client.disconnect(); done(); });
    });
  });

  // NOTE(bajtos): following tests do not verify that data is actually shared
  // between the workers, because I was not able to force socket.io client
  // to reconnect using the same client id.
  describe('per-client store', function() {
    var client;
    beforeEach(createClient);
    afterEach(closeClient);

    it('shares user data', function(done) {
      var PAYLOAD = 'a-string-data';
      client.emit('save', PAYLOAD);
      client.on('saved', function() {
        client.emit('load');
      });

      client.on('loaded', function(data) {
        expect(data).to.equal(PAYLOAD);
        done();
      });
    });

    it('checks for existence of a shared entry', function(done) {
      client.emit('save', 'a-value');
      client.on('saved', function() {
        client.emit('check');
      });

      client.on('checked', function(data) {
        expect(data).to.equal(true);
        done();
      });
    });

    it('deletes a shared entry', function(done) {
      client.emit('save', 'a-value');
      client.on('saved', function() {
        client.emit('delete');
      });
      client.on('deleted', function(data) {
        client.emit('check');
      });

      client.on('checked', function(data) {
        expect(data).to.equal(false);
        done();
      });
    });

    function createClient(done) {
      debug('creating a new socket.io client');
      client = ioClient.connect(
        serverUrl,
        {
          reconnect: false,
          'force new connection': true
        }
      );

      client.on('error', function(err) {
        debug('client error', err);
        done(err);
      });

      client.on('connect', function() {
        debug('client connected');
        done();
      });
    }

    function closeClient(done) {
      client.once('disconnect', function() {
        debug('client disconnected');
        done();
      });
      client.disconnect();
    }
  });
});

var WORKER_COUNT = 2;

function getNumberOfWorkers() {
  return Object.keys(cluster.workers).length;
}

function setupWorkers(done) {
  if (getNumberOfWorkers() > 0) {
    var msg = 'Cannot setup workers: there are already other workers running.';
    return done(new Error(msg));
  }

  cluster.setupMaster({ exec: __filename });
  ClusterStore.setup();

  var workersListening = 0;
  cluster.on('listening', function(w, addr) {
    if (!serverUrl) serverUrl = 'http://localhost:' + addr.port;

    workersListening++;
    if (workersListening == WORKER_COUNT) {
      done();
    }
  });

  for (var i = 0; i < WORKER_COUNT; i++) {
    cluster.fork();
  }
}

function stopWorkers(done) {
  cluster.disconnect(done);
}

function startSocketIoServer() {
  var PORT = 0; // Let the OS pick any available port
  var options = { store: new ClusterStore() };
  var server = ioServer.listen(PORT, options);

  server.on('connection', function(socket) {
    socket.on('save', function(data) {
      socket.set('test-data', data, function() { socket.emit('saved'); });
    });

    socket.on('load', function() {
      socket.get('test-data', function(err, result) {
        socket.emit('loaded', result);
      });
    });

    socket.on('check', function() {
      socket.has('test-data', function(err, result) {
        socket.emit('checked', result);
      });
    });

    socket.on('delete', function() {
      socket.del('test-data', function() {
        socket.emit('deleted');
      });
    });
  });
}
