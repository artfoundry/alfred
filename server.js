#! /usr/bin/env node

'use strict';

const alfredNPMpath = "" // Need to fill in value when installed on NPM server.
const branchDirectory = "" // Need to fill in value for branch location.
const sysLogsDirectory = "" // Need to fill in value for location where Alfred logs will go.

const server = require('http').createServer(httpFileHandler);
const io = require('socket.io')(server);
const readline = require('readline');
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});
const url = require('url');
const child_process = require('child_process');
const fs = require('fs');
const { parse } = require('querystring');
const path = require('path');
const mkdirp = require('mkdirp');
const PORT = 3000;
let gBranchListStr = ' all branches';
let gNextMaintDate = null;
let gOptionsFormData = [];
let gTimesSelected = {};
let gMaintIsGo = false;
let gUseSchedule = false;
let gWatcher = null;
let gIsTest = false;
let gMaintIsRunning = false;

(function() {
	console.log('Checking your version of Alfred...');
	child_process.exec(`npm outdated -g ${alfredNPMpath} --json`, (error, stdout, stderr) => {
		// npm outdated exits with code of 1 when wanted version exists, so need to check for stdout first
		// if stdout returns either empty string or string of json object
		if (stdout === '') {
			console.log('Running the latest version of Alfred. Time to get to work!');
			init();
		} else if (stdout.slice(0,1) === '{') {
			let versions = JSON.parse(stdout)[alfredNPMpath];

			rl.question(`Your global version of Alfred is at ${versions.current}, but the latest version is ${versions.latest}. Do you want to update? (Y/n) `, (answer) => {
				if (answer.match(/^\r?\n?y?(es)?$/i)) {
					installLatest(versions.latest);
				} else {
					init();
				}
				rl.close();
			});
		} else if (error) {
			console.log(stderr);
			throw error;
		}
	});
})();

// version: string of latest version number
function installLatest(version) {
	console.log(`Installing version ${version}`);
	child_process.exec(`npm install -g ${alfredNPMpath}`, (error, stdout, stderr) => {
		if (error) {
			console.log(stderr);
			throw error;
		} else {
			console.log(stdout);
			console.log('Alfred has been udpated and will now quit. Relaunch to get back to work!');
		}
		process.exit();
	});
}

function init() {
	process.argv.forEach((val, index) => {
		if (index > 1) {
			gOptionsFormData.push(val);
		}
	});
	if (gOptionsFormData.length > 0) {
		runAlfred();
	} else {
		console.log('Open http://localhost:3000 to get started');
		startServer();
	}
}


function httpFileHandler(request, response) {
	const parsedUrl = url.parse(request.url);
	let pathname = parsedUrl.pathname === '/' ? path.join(__dirname, 'index.html') : path.join(__dirname, parsedUrl.pathname);
	const ext = path.parse(pathname).ext;
	const map = {
		'.ico': 'image/x-icon',
		'.html': 'text/html',
		'.js': 'text/javascript',
		'.json': 'application/json',
		'.css': 'text/css',
		'.png': 'image/png',
		'.jpg': 'image/jpeg'
	};

	fs.readFile(pathname, (err, data) => {
		if (err){
			response.statusCode = 500;
			response.end(`Error getting the file: ${err}.`);
		} else {
			response.writeHead(200, {'Content-type': map[ext] || 'text/plain'});
			response.end(data);
		}
	});
};

function startServer() {
	server.listen(PORT);
	io.set('heartbeat timeout', 60000);
	io.set('heartbeat interval', 25000);
	io.on('connection', (socket) => {
		let savedBranches = [];

		console.log('connected to client');
		fs.readdir(branchDirectory, (err, branches) => {
			if (branches !== savedBranches) {
				if (err) throw err;
				savedBranches = branches;
				socket.emit('listbranches', branches);
			}
		});
		if (gOptionsFormData.length > 0 && gUseSchedule) {
			getNextTime();
			socket.emit('print info', gBranchListStr, gNextMaintDate.toString());
		}
		socket.on('send form data', () => {
			socket.emit('restore form options', gOptionsFormData, gTimesSelected);
		});
		socket.on('open log', (path) => {
			let text = fs.readFileSync(path, 'utf8');
			if (text) {
				console.log('displaying maintenance log');
				socket.emit('display error log', text);
			}
		});
		socket.on('start maintenance', (formData, repeatMaint, scheduleData, isTest) => {
			gOptionsFormData = formData;
			gTimesSelected = scheduleData;
			gUseSchedule = repeatMaint;
			gIsTest = isTest;
			if (gUseSchedule)
				console.log('schedule set');
			prepMaintOptions(socket);
		});
		socket.on('stop maintenance', () => {
			if (gWatcher && !gMaintIsRunning) {
				gWatcher.close();
			}
			resetMaintSettings();
			console.log('maintenance cancelled');
			socket.emit('print info', null, null, 'Maintenance cancelled.');
		});
		socket.on('continue schedule', () => {
			getNextTime();
			prepMaintOptions(socket);
			// only want maint. to occur twice for testing
			if (gIsTest) {
				// wait till next cycle starts before resetting - getNextTime sets time for one min later
				setTimeout(() => {
					resetMaintSettings();
					gIsTest = false;
				}, 63000);
			}
		});
	});
	io.on('disconnect', () => {
		if (gWatcher) gWatcher.close();
	});
}

function resetMaintSettings() {
	gMaintIsGo = false;
	gNextMaintDate = null;
	gTimesSelected = {};
	gUseSchedule = false;
}

// socket: socket.io object
function prepMaintOptions(socket) {
	let lastOptionIndex = gOptionsFormData.length - 2;

	if (gOptionsFormData[lastOptionIndex] === '-b') {
		gBranchListStr = gOptionsFormData[lastOptionIndex + 1].replace(/,/g, ', ');
	}
	gUseSchedule ? getNextTime() : gNextMaintDate = new Date();
	gMaintIsGo = true;
	startMaint(socket);
}

// socket: socket.io object
function startMaint(socket) {
	let logsPath = path.join(sysLogsDirectory, 'alfred');
	let storage = '';
	let newContent = '';

	socket.emit('print info', gBranchListStr, gNextMaintDate.toString());
	mkdirp.sync(logsPath);
	gWatcher = fs.watch(logsPath, (eventType, filename) => {
		if (eventType === 'change' && filename && filename === 'temp-status-log.txt') {
			let fileContent = fs.readFileSync(path.join(logsPath, filename), 'utf8');

			if (fileContent !== storage) {
				console.log('reading new log content')
				newContent = fileContent.replace(storage, ''); // remove content we've already printed
				storage = fileContent;
				socket.emit('maintLog', newContent);
				if (newContent.search(/Branch Maintenance Summary/) !== -1) {
					storage = newContent = '';
					gWatcher.close();
					socket.emit('endmaint');
					console.log('maintenance done');
				}
			}
		}
	});
	let maintCheck = setInterval(() => {
		let currentDate = new Date();
		if (gMaintIsGo && gNextMaintDate.getDate() === currentDate.getDate() && gNextMaintDate.getHours() === currentDate.getHours()) {
			if (!gIsTest || (gIsTest && gNextMaintDate.getMinutes() === currentDate.getMinutes())) {
				console.log('starting maintenance');
				if (!gUseSchedule) {
					resetMaintSettings();
				}
				clearInterval(maintCheck);
				runAlfred();
			}
		}
	}, 3000);
}

function getNextTime() {
	let currentDate = new Date();
	let currentDay = currentDate.getDay();
	let currentHour = currentDate.getHours();
	let dayAdjustmentVal = 0;
	let timeAdjustmentVal = 0;
	let lowestTimeInterval = null;
	let remainingTime = null;
	let soonestHour = null;
	let soonestDay = null;

	// for testing
	if (gIsTest) {
		gNextMaintDate = new Date();
		gNextMaintDate.setDate(currentDate.getDate());
		gNextMaintDate.setHours(currentHour);
		gNextMaintDate.setMinutes(currentDate.getMinutes() + 2);
		gNextMaintDate.setSeconds(0);
		return;
	}

	for (let i=0; i < gTimesSelected.hours.length; i++) {
		timeAdjustmentVal = gTimesSelected.hours[i] <= currentHour ? 24 : 0;
		remainingTime = gTimesSelected.hours[i] + timeAdjustmentVal - currentHour;
		if (lowestTimeInterval === null || (lowestTimeInterval > remainingTime)) {
			lowestTimeInterval = remainingTime;
			soonestHour = gTimesSelected.hours[i];
		}
	}
	lowestTimeInterval = null;
	for (let i=0; i < gTimesSelected.days.length; i++) {
		// if time is same and day is the same or earlier in the week (week starts sun), or time is later and day is earlier, increase day interval by 1 week
		if ((soonestHour <= currentHour && gTimesSelected.days[i] <= currentDay) || (soonestHour > currentHour && gTimesSelected.days[i] < currentDay)) {
			dayAdjustmentVal = 7;
		}
		remainingTime = gTimesSelected.days[i] + dayAdjustmentVal - currentDay;
		if (lowestTimeInterval === null || (lowestTimeInterval > remainingTime)) {
			lowestTimeInterval = remainingTime;
			soonestDay = currentDate.getDate() + lowestTimeInterval;
		}
		dayAdjustmentVal = 0;
	}
	gNextMaintDate = new Date();
	gNextMaintDate.setDate(soonestDay);
	gNextMaintDate.setHours(soonestHour);
	gNextMaintDate.setMinutes(0);
	gNextMaintDate.setSeconds(0);
}

function runAlfred() {
	let alfredPath = path.join(__dirname, 'alfred.sh');
	let optionsStr = gOptionsFormData.join(' ');

	console.log(`running bash alfred.sh ${optionsStr}`);
	gMaintIsRunning = true;

	child_process.execFile(alfredPath, gOptionsFormData, (error, stdout, stderr) => {
		if (error) {
			console.log(stderr);
			throw error;
		} else {
			console.log(stdout);
		}
		gMaintIsRunning = false;
	});
}
