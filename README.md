# Socket.io Store for Cluster

[![Build Status](https://travis-ci.org/strongloop/strong-cluster-socket.io-store.png?branch=master)](https://travis-ci.org/strongloop/strong-cluster-socket.io-store)
[![NPM version](https://badge.fury.io/js/strong-cluster-socket.io-store.png)](http://badge.fury.io/js/strong-cluster-socket.io-store)

## Overview

Strong-cluster-socket.io-store is an implementation of socket.io store
using node's native cluster messaging. It provides an easy solution
for running socket.io server in a node cluster.

### Features

- No dependencies on external services.
- Module is shipped without socket.io, it will use *your* version of socket.io.
- Covered by unit-tests.

### WARNING

Socket.io's implementation has a race condition that allows the client
to send the websocket request to another worker before that worker
has processed the notification about a successful handshake. See 
[socket.io#952](https://github.com/LearnBoost/socket.io/issues/952).

You have to enable session affinity (sticky sessions) in your load-balancer
to get your socket.io server working in the cluster.

## Usage

### Installation

```sh
$ npm install strong-cluster-socket.io-store
```

### Configuration


```javascript
var io = require('socket.io');
var ClusterStore = require('strong-cluster-socket.io-store')(io);

if (cluster.isMaster) {
  // Setup your master and fork workers.
} else {
  // Start a socket.io server, configure it to use ClusterStore.
  io.listen(port, { store: new ClusterStore() });
  // etc.
}
```

### Setting up the master process

The store requires that a shared-state server is running in the master process.
The server is initialized automatically when you require() this module
from the master. In the case that your master and workers have separate source
files, you must explicitly require this module in your master source file.
Optionally, you can call `setup()` to make it more obvious why you are loading
a module that is not used anywhere else.

```javascript
// master.js

var cluster = require('cluster');
// etc.

require('strong-cluster-socket.io-store').setup();

// configure your cluster
// fork the workers
// etc.
```
