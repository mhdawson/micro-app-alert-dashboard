var fs = require('fs');
var mqtt = require('mqtt');
var socketio = require('socket.io');
var twilio = require('twilio');

const BORDERS = 15;
const HEIGHT_PER_ENTRY = 33;
const RESET_BUTTON_HEIGHT = 33;
const PAGE_WIDTH = 280;
const MILLIS_PER_SECOND = 1000;

var eventSocket = null;

var Server = function() {
}


Server.getDefaults = function() {
  return { 'title': 'House Alert Data' };
}


var replacements;
Server.getTemplateReplacments = function() {
  if (replacements === undefined) {
    var config = Server.config;
    var height = BORDERS + RESET_BUTTON_HEIGHT;
    var dashBoardEntriesHTML = new Array();

    for (i = 0; i < config.dashboardEntries.length; i++) {
      dashBoardEntriesHTML[i] = '<tr><td style="width:50%" bgcolor="#E0E0E0">' + config.dashboardEntries[i].name + '</td><td id="' +
                                config.dashboardEntries[i].id + '"></td></tr>';

      height = height + HEIGHT_PER_ENTRY;
    }

    replacements = [{ 'key': '<DASHBOARD_TITLE>', 'value': Server.config.title },
                    { 'key': '<UNIQUE_WINDOW_ID>', 'value': Server.config.title },
                    { 'key': '<DASHBOARD_ENTRIES>', 'value': dashBoardEntriesHTML.join("") },
                    { 'key': '<PAGE_WIDTH>', 'value': PAGE_WIDTH },
                    { 'key': '<PAGE_HEIGHT>', 'value': height }];

  }
  return replacements;
}


var alertTopicsMap = new Object();
var resetTopicsMap = new Object();
var status = new Object();
Server.startServer = function(server) {
  var config = Server.config;
  for (i = 0; i < config.dashboardEntries.length; i++) {
    alertTopicsMap[config.dashboardEntries[i].alertTopic] = config.dashboardEntries[i].id;
    if ((config.dashboardEntries[i].alertTopic != undefined) && (config.dashboardEntries[i].resetTopic !== "")) {
      resetTopicsMap[config.dashboardEntries[i].resetTopic] = config.dashboardEntries[i].id;
    }
    status[config.dashboardEntries[i].id] = new Object;
    status[config.dashboardEntries[i].id].id= config.dashboardEntries[i].id;
    status[config.dashboardEntries[i].id].status = "GREEN";
    status[config.dashboardEntries[i].id].config = config.dashboardEntries[i];
  }

  var mqttOptions;
  if (Server.config.mqttServerUrl.indexOf('mqtts') > -1) {
    mqttOptions = { key: fs.readFileSync(path.join(__dirname, 'mqttclient', '/client.key')),
                    cert: fs.readFileSync(path.join(__dirname, 'mqttclient', '/client.cert')),
                    ca: fs.readFileSync(path.join(__dirname, 'mqttclient', '/ca.cert')),
                    checkServerIdentity: function() { return undefined }
    }
  }

  var mqttClient = mqtt.connect(Server.config.mqttServerUrl, mqttOptions);
  eventSocket = socketio.listen(server);

  eventSocket.on('connection', function(client) {
    for (var key in status) {
      sendStatus(status[key])
    }

    client.on('RESET', function() {
      for (var key in status) {
        var entry = status[key];
        entry.status = 'GREEN';
        clearPendingEvent(entry);
        sendStatus(entry);
      }
    });
  });

  mqttClient.on('connect',function() {
    for(var key in alertTopicsMap) {
      mqttClient.subscribe(key);
    }
    for(var key in resetTopicsMap) {
      mqttClient.subscribe(key);
    }
  });

  mqttClient.on('message', function(topic, message) {
    if (alertTopicsMap[topic] !== undefined) {
      setStatusAlerted(alertTopicsMap[topic]);
    } else if (resetTopicsMap[topic] !== undefined) {
      setStatusReset(resetTopicsMap[topic]);
    }
  });
}


var sendStatus = function(entry) {
  eventSocket.emit('data', {'type': 'ENTRY_STATUS', 'id': entry.id, 'state': entry.status});
}


var clearPendingEvent = function(entry) {
  if (entry.pending !== undefined) {
    clearTimeout(entry.pending);
    entry.pending = undefined;
  }
}


var setStatusAlerted = function(id) {
  var entry = status[id];
  if ((entry.config.delay === undefined) || (entry.config.delay === 0)) {
    entry.status = 'RED'
    sendAlert(entry);
  } else {
    if (entry.status === 'GREEN') {
      entry.status = 'AMBER';
      entry.pending = setTimeout(function() {
        entry.status = 'RED';
        sendStatus(entry);
        sendAlert(entry);
      }, entry.config.delay * MILLIS_PER_SECOND);
    }
  }
  sendStatus(entry);
}


var setStatusReset = function(id) {
  var entry = status[id];
  entry.status = 'GREEN';
  clearPendingEvent(entry);
  sendStatus(entry);
}


var sendAlert = function(entry) {
  if (Server.config.twilio !== undefined) {
    var twilioClient = new twilio.RestClient(Server.config.twilio.twilioAccountSID,
                                             Server.config.twilio.twilioAccountAuthToken);
    twilioClient.sendMessage({
      to: Server.config.twilio.twilioToNumber,
      from: Server.config.twilio.twilioFromNumber,
      body: 'Home Alert Dashboard:' + entry.config.name
    }, function(err, message) {
      if (err) {
        console.log('Failed to send sms:' + err.message);
      } else {
        console.log('SMS Sent:' + message.sid);
      }
    });
  }
}


if (require.main === module) {
  var path = require('path');
  var microAppFramework = require('micro-app-framework');
  microAppFramework(path.join(__dirname), Server);
}
