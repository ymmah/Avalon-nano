var Pool = function(id, url, port, username, password) {
	var difficulty = 1;
	var nonce1 = null;
	var nonce2Size = null;

	var submitId = 0;
	var AUTHORIZE = Pool.stratumEncode({
		id: 2,
		method: "mining.authorize",
		params: [username, password || "1234"],
	});

	var header = "POOL" + id;
	var watcherId;

	var socketId = null;
	var alive = true;

	var onJob = new MinerEvent();
	var onError = new MinerEvent();

	var watcher = function() {
		chrome.sockets.tcp.create({}, function(createInfo) {
			var socketId = createInfo.socketId;
			var error = false;
			var wait = setTimeout(function() {
				error = true;
				utils.log("warn", ["Connection lost (Timed out)"], header, "color: red");
				alive = false;
				onError.fire(id);
			}, 5000);
			chrome.sockets.tcp.connect(socketId, url, port, function(result) {
				clearTimeout(wait);
				if (chrome.runtime.lastError) {
					if (error) {
						chrome.sockets.tcp.close(socketId, function() {});
						return;
					}
					utils.log("warn", ["Connection lost"], header, "color: red");
					alive = false;
					onError.fire(id);
					chrome.sockets.tcp.close(socketId, function() {});
					return;
				}
				chrome.sockets.tcp.disconnect(socketId, function() {
					chrome.sockets.tcp.close(socketId, function() {
						clearTimeout(watcherId);
						watcherId = setTimeout(watcher, 5000);
					});
				});
			});
		});
	};

	var send = function(data, retry) {
		utils.log("log", ["Sent:     %s", utils.ab2asc(data)],
			header, "color: darksalmon");
		chrome.sockets.tcp.send(socketId, data, function(sendInfo) {
			if (chrome.runtime.lastError) {
				utils.log("error", [chrome.runtime.lastError.message], header);
				if (retry)
					send(data, retry - 1);
				return;
			}
		});
	};

	var receive = function(stratum) {
		clearTimeout(watcherId);
		watcherId = setTimeout(watcher, 1000);
		utils.log("log", ["Received: %s", utils.ab2asc(stratum)],
			header, "color: goldenrod");
		for (var data of Pool.stratumDecode(stratum)) {
			decode(data);
		}
	};

	var decode = function(data) {
		switch (data.method) {
		case "mining.set_difficulty":
			difficulty = data.params[data.params.length - 1];
			break;
		case "mining.notify":
			var job = {
				poolId: id,
				nonce1: nonce1,
				nonce2Size: nonce2Size,
				jobId: data.params[0],
				prevhash: data.params[1],
				coinbase1: data.params[2],
				coinbase2: data.params[3],
				merkleBranch: data.params[4],
				version: data.params[5],
				nbits: data.params[6],
				ntime: data.params[7],
				cleanJobs: data.params[8],
				target: utils.getTarget(difficulty)
			};
			onJob.fire(job);
			break;
		case "mining.ping":
			send(Pool.stratumEncode({
				"id": data.id,
				"result": "pong",
				"error": null
			}));
			break;
		case "client.reconnect":
			disconnect();
			connect();
			break;
		default:
			if (data.id === 1) {
				// subscription
				if (data.error) {
					return false;
				}
				nonce1 = data.result[data.result.length - 2];
				nonce2Size = data.result[data.result.length - 1];
				if (data.result[0][0][0] === 'mining.set_difficulty')
					difficulty = data.result[0][0][1];
				send(AUTHORIZE);
			} else if (data.id === 2) {
				// authorization
				if (data.error) {
					return false;
				}
			} else if (data.id >= 1000){
				// submission
				if (data.error) {
					return false;
				}
				if (!data.result) {
					// data["reject-reason"];
					return false;
				}
			}
			break;
		}
	};

	var connect = function() {
		chrome.sockets.tcp.create({}, function(createInfo) {
			socketId = createInfo.socketId;
			var error = false;
			var wait = setTimeout(function() {
				error = true;
				utils.log("warn", ["Connection failed (Timed out)"], header, "color: red");
				alive = false;
				onError.fire(id);
			}, 5000);
			chrome.sockets.tcp.connect(socketId, url, port, function(result) {
				clearTimeout(wait);
				if (chrome.runtime.lastError) {
					if (error) {
						chrome.sockets.tcp.close(socketId, function() {});
						return;
					}
					utils.log("warn", ["Connection failed"], header, "color: red");
					alive = false;
					onError.fire(id);
					chrome.sockets.tcp.close(socketId, function() {});
					return;
				}
				utils.log("info", ["Connected"], header, "color: maroon");
				alive = true;
				send(Pool.SUBSCRIBE);
				watcherId = setTimeout(watcher, 5000);
			});
		});
	};

	var disconnect = function() {
		clearTimeout(watcherId);
		if (socketId !== null)
			chrome.sockets.tcp.disconnect(socketId, function() {
				chrome.sockets.tcp.close(socketId, function() {
					utils.log("info", ["Disconnected"], header, "color: maroon");
				});
			});
	};

	var submit = function(jobId, nonce2, ntime, nonce) {
		utils.log("info", ["Submitted"], header, "color: orangered");
		var data = {
			params: [username, jobId, nonce2, ntime, nonce],
			id: 1000 + submitId,
			method: "mining.submit",
		};
		submitId = (submitId + 1) % 1000;
		send(Pool.stratumEncode(data), 3);
	};

	// getters
	Object.defineProperties(this, {
		id: {get: function() {return id;}},
		socketId: {get: function() {return socketId;}},
		alive: {get: function() {return alive;}},
	});

	// events
	this.onJob = onJob;
	this.onError = onError;

	// public functions
	this.receive = receive;
	this.connect = connect;
	this.disconnect = disconnect;
	this.submit = submit;
};

Pool.stratumEncode = function(data) {
	return utils.str2ab(JSON.stringify(data) + "\n");
};

Pool.stratumDecode = function(stratum) {
	return utils.ab2asc(stratum).slice(0, -1).split("\n").map(function(data) {
		return JSON.parse(data);
	});
};

Pool.SUBSCRIBE = Pool.stratumEncode({
	id: 1,
	method: "mining.subscribe",
	params: ["avalon-miner-chrome"]
});
