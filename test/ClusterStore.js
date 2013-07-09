var cluster = require('cluster');
var expect = require('chai').expect;
var ioServer = require('socket.io');
var ioClient = require('socket.io-client');
var Store = require('..')(ioServer);

var SERVER_URL = 'http://localhost:8880';

if (cluster.isWorker) {
  startSocketIoServer();
  return;
}

describe('clustered socket.io server', function() {
  before(setupWorkers);
  after(stopWorkers);

  var client;
  beforeEach(createClient);
  afterEach(closeClient);

  it('shares hand-shaken connections', function(done) {
    client.on('error', function(err) { done(err); });
    client.on('connect', function() { client.disconnect(); done(); });
  });

  // NOTE(bajtos): following tests do not verify that data is actually shared
  // between the workers, because I was not able to force socket.io client
  // to reconnect using the same client id.

  it('shares user data', function(done) {
    var PAYLOAD = 'a-string-data';
    client.on('connect', function() {
      client.emit('save', PAYLOAD);
      client.on('saved', function() {
        client.emit('load');
      });

      client.on('loaded', function(data) {
        expect(data).to.equal(PAYLOAD);
        done();
      });
    });
  });

  it('checks for existence of a shared entry', function(done) {
    client.on('connect', function() {
      client.emit('save', 'a-value');
      client.on('saved', function() {
        client.emit('check');
      });

      client.on('checked', function(data) {
        expect(data).to.equal(true);
        done();
      });
    });
  });

  it('deletes a shared entry', function(done) {
    client.on('connect', function() {
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
  });

  function createClient() {
    client = ioClient.connect(
      SERVER_URL,
      {
        reconnect: false,
        'force new connection': true
      }
    );
  }

  function closeClient() {
    client.disconnect();
  }
});

var WORKER_COUNT = 2;
var workers;

function setupWorkers(done) {
  cluster.setupMaster();
  cluster.settings.exec = __filename;
  Store.setupMaster();

  cluster.on('listening', function(w) {
    workers = workers || [];
    workers.push(w);
    if (workers.length == WORKER_COUNT) {
      done();
    }
  });

  for (var i = 0; i < WORKER_COUNT; i++) {
    cluster.fork();
  }
}

function stopWorkers(done) {
  workers.forEach(function(w) { w.kill(); });
  done();
}

function startSocketIoServer() {
  var server = ioServer.listen(
    Number(require('url').parse(SERVER_URL).port),
    {
      store: new Store()
    }
  );

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
