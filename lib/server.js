// Copyright 2015-2017 the project authors as listed in the AUTHORS file.
// All rights reserved. Use of this source code is governed by the
// license that can be found in the LICENSE file.
"use strict";

const fs = require('fs');
const mqtt = require('mqtt');
const path = require('path');
const socketio = require('socket.io');
const twilio = require('twilio');

const BORDERS = 15;
const HEIGHT_PER_ENTRY = 33;
const RESET_BUTTON_HEIGHT = 33;
const PAGE_WIDTH = 280;
const MILLIS_PER_SECOND = 1000;

let eventSocket = null;

const Server = function() {
}


Server.getDefaults = function() {
  return { 'title': 'House Alert Data' };
}


let replacements;
Server.getTemplateReplacments = function() {
  if (replacements === undefined) {
    const config = Server.config;
    let height = BORDERS + RESET_BUTTON_HEIGHT;
    const dashBoardEntriesHTML = new Array();

    for (let i = 0; i < config.dashboardEntries.length; i++) {
      dashBoardEntriesHTML[i] = '<tr><td style="width:50%" bgcolor="#E0E0E0">' +
                                config.dashboardEntries[i].name + '</td><td id="' +
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


const alertTopicsMap = new Object();
const resetTopicsMap = new Object();
const status = new Object();
Server.startServer = function(server) {
  const config = Server.config;
  for (let i = 0; i < config.dashboardEntries.length; i++) {
    alertTopicsMap[config.dashboardEntries[i].alertTopic] =
      config.dashboardEntries[i].id;
    if ((config.dashboardEntries[i].alertTopic != undefined) &&
        (config.dashboardEntries[i].resetTopic !== "")) {
      resetTopicsMap[config.dashboardEntries[i].resetTopic] =
        config.dashboardEntries[i].id;
    }
    status[config.dashboardEntries[i].id] = new Object;
    status[config.dashboardEntries[i].id].id= config.dashboardEntries[i].id;
    status[config.dashboardEntries[i].id].status = "GREEN";
    status[config.dashboardEntries[i].id].config = config.dashboardEntries[i];
  }

  let mqttOptions;
  if (Server.config.mqttServerUrl.indexOf('mqtts') > -1) {
    mqttOptions = { key: fs.readFileSync(path.join(__dirname, 'mqttclient', '/client.key')),
		    cert: fs.readFileSync(path.join(__dirname, 'mqttclient', '/client.cert')),
		    ca: fs.readFileSync(path.join(__dirname, 'mqttclient', '/ca.cert')),
		    checkServerIdentity: function() { return undefined }
    }
  }

  const mqttClient = mqtt.connect(Server.config.mqttServerUrl, mqttOptions);
  eventSocket = socketio.listen(server);

  eventSocket.on('connection', function(client) {
    for (let key in status) {
      sendStatus(status[key])
    }

    client.on('RESET', function() {
      for (let key in status) {
 	      const entry = status[key];
     	  entry.status = 'GREEN';
     	  clearPendingEvent(entry);
     	  sendStatus(entry);
      }
    });
  });

  mqttClient.on('connect',function() {
    for(let key in alertTopicsMap) {
      mqttClient.subscribe(key);
    }
    for(let key in resetTopicsMap) {
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


const sendStatus = function(entry) {
  eventSocket.emit('data', {'type': 'ENTRY_STATUS', 'id': entry.id, 'state': entry.status});
}


const clearPendingEvent = function(entry) {
  if (entry.pending !== undefined) {
    clearTimeout(entry.pending);
    entry.pending = undefined;
  }
}


const setStatusAlerted = function(id) {
  const entry = status[id];
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


const setStatusReset = function(id) {
  const entry = status[id];
  entry.status = 'GREEN';
  clearPendingEvent(entry);
  sendStatus(entry);
}


const sendAlert = function(entry) {
  if (Server.config.twilio !== undefined) {
    const twilioClient = new twilio.RestClient(Server.config.twilio.twilioAccountSID,
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
  const microAppFramework = require('micro-app-framework');
  microAppFramework(path.join(__dirname), Server);
}
