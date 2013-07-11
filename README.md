strong-cluster-socket.io-store
==============================

strong-cluster-socket.io-store provides an implementation of socket.io store
using node's native cluster messaging.

# Usage

```javascript
var io = require('socket.io');
var Store = require('strong-cluster-socket.io-store')(io);

if (cluster.isWorker) {
  var io = require('socket.io');
  io.listen(port, { store: new Store() });
}

// In case you have a standalone master file,
// you have to require() this module in order to setup
// message-queue and shared-state servers.
// Optionally you can also add a call to setup() function,
// which serves as a documentation for require().
require('strong-cluster-socket.io-store')(require('socket.io')).setup();
```

TODO(bajtos): Improve the sample, explain what's going on and why.
