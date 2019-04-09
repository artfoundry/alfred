'use strict';

let testRun;

(function() {
	const socket = io.connect('http://localhost:3000');
	let repeatMaint = false;
	let mandatoryInputs = document.querySelectorAll('.mandatory-container');
	let branchOptionsToggles = document.querySelectorAll('.branch-option-toggle');
	let dayToggles = document.querySelectorAll('.date-toggle-day');
	let optionsFormEl = document.getElementById('form-options');
	let scheduleFormEl = document.getElementById('form-schedule');
	let cleanToggle = document.getElementById('skip-clean-toggle');
	let emailToggle = document.getElementById('emails-toggle');
	let optionsFormData = [];
	let timesSelected = {};
	let isTest = false;

	if (!socket) {
		displayWarning("Can't connect to the server. Try restarting the server and/or reloading the page.");
	} else {
		socket.on('connect', () => {
			console.log('Connected to server');
		});
		socket.on('disconnect', (reason) => {
			console.log('Disconnected from server: '+ reason);
			if (reason === 'io server disconnect') {
				// the disconnection was initiated by the server, need to reconnect manually
				socket.connect();
			}
			// else the socket will automatically try to reconnect
		});
	}

	cleanToggle.addEventListener('click', () => {
		if (cleanToggle.checked)
			displayWarning("WARNING! Clean should only be disabled after resolving conflicts. Make sure you know what you're doing!");
	});
	branchOptionsToggles.forEach((el) => {
		el.addEventListener('click', (e) => {
			toggleBranchOptions(e.target.id);
		}); 
	});
	emailToggle.addEventListener('click', toggleEmailEntry);
	dayToggles.forEach((el) => { el.addEventListener('click', toggleTimeCheckboxes); });
	document.querySelector('.make-active').addEventListener('click', switchForms);
	document.getElementById('date-toggle').addEventListener('click', () => {
		toggleScheduleOption();
	});
	document.getElementById('clear-button').addEventListener('click', clearResults);

	socket.on('listbranches', (localBranches) => {
		updateBranchOptions(localBranches);
		socket.emit('send form data');
	});
	socket.on('maintLog', (data) => { printResults(data, socket); });
	socket.on('print info', (branchListStr, nextMaintDate, otherMessage = null) => {
		if (otherMessage) { // for example, maint cancelled message
			printResults(otherMessage, socket);
		} else if (branchListStr.length > 0) {
			printResults(`<p>Starting maintenance for ${branchListStr} at ${nextMaintDate}</p>`, socket);
		}
	});
	socket.on('restore form options', (formData, scheduleData) => {
		if (formData.length > 0 || Object.keys(scheduleData).length > 0) {
			optionsFormData = formData;
			timesSelected = scheduleData;
			restoreFormOptions(optionsFormData, optionsFormEl, timesSelected, scheduleFormEl);
		}
	});
	socket.on('endmaint', () => {
		cleanToggle.checked = false;
		if (repeatMaint) {
			socket.emit('continue schedule');
		}
	});	

	document.getElementById('cancel-button').addEventListener('click', () => {
		timesSelected = {};
		repeatMaint = false;
		socket.emit('stop maintenance');
	});

	document.getElementById('start-button').addEventListener('click', () => {
		if (getIsMaintReady(mandatoryInputs)) {
			optionsFormData = processOptionsData(optionsFormEl);
			if (document.getElementById('date-toggle').checked) {
				timesSelected = processScheduleData(scheduleFormEl);
				repeatMaint = true;
				if (timesSelected.hours.length === 0) {
					displayWarning('Must select at least one day and one time');
					return;
				}
			}
			socket.emit('start maintenance', optionsFormData, repeatMaint, timesSelected, isTest);
		} else {
			displayWarning('Need to select one of the mandatory options');
		}
	});

	// for debugging using local svn repo
	testRun = function(scheduleOn) {
		isTest = true;
		document.getElementById('prodbranches-toggle').removeAttribute('checked');
		if (scheduleOn) {
			repeatMaint = true;
			socket.emit('start maintenance', ['-a', ''], repeatMaint, { 'days': [0], 'hours': [0] }, isTest);
		} else
			console.log('no "scheduleOn" boolean passed in, so just testing regular functions');
		isTest = false;
	}
})();

// mandatoryInputs: array of elements containing the "mandatory-container" class - each container must have one of its mandatory options selected
function getIsMaintReady(mandatoryInputs) {
	let optionsSelected = 0;

	mandatoryInputs.forEach((container) => {
		let options = container.querySelectorAll('.mandatory-option');
		for (let i=0; i < options.length; i++) {
			if (options[i].checked) {
				optionsSelected += 1;
				break;
			}
		};
	});
	return optionsSelected === mandatoryInputs.length ? true : false;
}

// formEl: form element containing maint options
function processOptionsData(formEl) {
	let formData = [];
	let branchFlag = '';
	let branchList = '';

	for (let i=0; i < formEl.elements.length; i++) {
		let el = formEl.elements[i];
		if ((el.type === 'checkbox' && el.checked === true) || ((el.type === 'text' || el.type === 'email') && el.value !== '')) {
			if (el.value === '-b' || el.value === '-a') {
				branchFlag = el.value;
			} else if (el.name.search(/branch-.+-toggle/) !== -1) {
				branchList += el.value + ',';
			} else {
				formData.push(el.value);
			}
		}
	}
	formData.push(branchFlag);
	formData.push(branchList.slice(0, -1)); // remove last comma
	return formData;
}

// formEl: form element containing scheduling options
function processScheduleData(formEl) {
	let formData = {'days': [], 'hours': []};

	for (let i=1; i < formEl.elements.length; i++) {
		let el = formEl.elements[i];
		if (el.checked === true) {
			if (el.classList.contains('date-toggle-day'))
				formData.days.push(parseInt(el.value));
			else if (el.classList.contains('date-toggle-time'))
				formData.hours.push(parseInt(el.value));
		}
	}
	return formData;
}


/********************
*    DOM updates    *
********************/

// results: string of info to display in the Results panel
function printResults(results, socket) {
	let resultsContainer = document.getElementById('results-text');
	let dateMarkup = '<p class="text-color-gray">'
	let date = new Date();
	let div = document.createElement('div');
	let link = null;

	dateMarkup = dateMarkup.concat(date.toString());
	div.innerHTML = dateMarkup.concat(':</p>', results.replace(/[\n\r]/g, '<br>'));
	link = div.querySelector('[data-log-link]');
	if (link) {
		link.addEventListener('click', (e) => {
			e.preventDefault();
			socket.emit('open log', link.dataset.logLink);
			socket.on('display error log', (text) => {
				let newWindow = window.open('', 'Maintenance log');
				if (newWindow) {
					let newBody = newWindow.document.querySelector('body');
					let content = newBody.querySelector('pre');
					if (content) {
						content.innerHTML = text;
					} else {
						let el = newWindow.document.createElement('pre');
						newBody.appendChild(el).innerHTML = text;
					} 
				} else {
					displayWarning('Popup blocked. Turn off the popup blocker to view the log.');
				}
			});
		});
	}
	resultsContainer.appendChild(div);
	resultsContainer.scrollTop = resultsContainer.scrollHeight;
}

function clearResults() {
	let resultsContainer = document.getElementById('results-text');
	let resultDivs = resultsContainer.querySelectorAll('div');

	if (resultDivs && resultDivs.length > 0) {
		resultDivs.forEach((el) => {
			resultsContainer.removeChild(el);
		});
	}
}

function switchForms() {
	let activeEls = document.querySelectorAll('.active');
	let inactiveEls = document.querySelectorAll('.inactive');
	let formTabs = document.querySelectorAll('.form-tab');

	formTabs.forEach(function(el) {
		if (el.classList.contains('make-active')) {
			el.removeEventListener('click', switchForms);
			el.classList.remove('make-active');
		} else {
			el.addEventListener('click', switchForms);
			el.classList.add('make-active');
		}
	});

	activeEls.forEach((el) => {
		el.classList.remove('active');
		el.classList.add('inactive');
	});

	inactiveEls.forEach((el) => {
		el.classList.remove('inactive');
		el.classList.add('active');
	});
}

// optionsFormData: array of Options tab form data (strings)
// optionsFormEl: #form-options element
// timesSelected: object with arrays for 'days' and 'hours'
// scheduleFormEl: #form-schedule element
function restoreFormOptions(optionsFormData, optionsFormEl, timesSelected, scheduleFormEl) {
	let itemFlag = '';
	let branchList = [];

	for (let item=0; item < optionsFormData.length; item++) {
		if (optionsFormData[item].slice(0,1) === '-') {
			itemFlag = optionsFormData[item].slice(0,2);
			optionsFormEl.querySelector(`input[value="${itemFlag}"]`).checked = true;
			if (itemFlag === '-b') {
				toggleBranchOptions('branches');
			}
		} else if (optionsFormData[item - 1] === '-e') {
			document.getElementById('emails').value = optionsFormData[item];
			toggleEmailEntry();
		} else if (optionsFormData[item - 1] === '-b') {
			branchList = optionsFormData[item].split(',');
			branchList.forEach((branch) => {
				document.getElementById(`branch-${branch}-toggle`).checked = true;
			});
		}
	};
	if (timesSelected.days) {
		document.getElementById('date-toggle').checked = true;
		toggleScheduleOption();
		toggleTimeCheckboxes();
		for (let option in timesSelected) {
			timesSelected[option].forEach((time) => {
				scheduleFormEl.querySelector(`#${option.slice(0,-1)}-toggle-${time}`).checked = true;
			});
		};
	}
}

// localBranches: array of branch names captured by node server from user's local branches directory
function updateBranchOptions(localBranches) {
	let branchesContainer = document.getElementById('branches');

	branchesContainer.innerHTML = '';
	localBranches.forEach((branch) => {
		if (branch.substring(0,1) !== '.') {
			let el = document.createElement('span');
			let label = `branch-${branch}-toggle`;
			el.innerHTML = `<input id="${label}" class="mandatory-option" type="checkbox" name="${label}" value="${branch}" disabled><label for="${label}">${branch}</label>`;
			branchesContainer.appendChild(el);
		}
	});
}

// targetId: Id of selected branches option - either 'branches-toggle' or 'allbranches-toggle'
function toggleBranchOptions(targetId) {
	let type = targetId.split('-')[0]; // the branch option (individual or all)
	let branchesToggle = document.getElementById('branches-toggle');
	let allbranchesToggle = document.getElementById('allbranches-toggle');
	let branches = document.getElementById('branches').querySelectorAll('input'); // all of the individual branches
	let cleanToggle = document.getElementById('skip-clean-toggle');

	if (type === 'branches') {
		allbranchesToggle.checked = false;
	}
	if (type === 'allbranches') {
		branchesToggle.checked = false;
	}
	branches.forEach((branch) => {
		if (branch.disabled && branchesToggle.checked) {
			branch.removeAttribute('disabled');
			branch.addEventListener('click', ()=> {
				toggleCleanOption(branch);
			});
		} else if (allbranchesToggle.checked || !branchesToggle.checked) {
			branch.disabled = true;
			branch.checked = false;
			branch.removeEventListener('click', toggleCleanOption);
			toggleCleanOption(branch);
		}
	});
}

function toggleCleanOption() {
	let cleanToggle = document.getElementById('skip-clean-toggle');
	let branches = document.getElementById('branches').querySelectorAll('input'); // all of the individual branches
	let branchesChecked = 0;

	branches.forEach((branch) => {
		if (branch.checked) branchesChecked++;
	});
	if (branchesChecked === 1) {
		cleanToggle.removeAttribute('disabled');
		cleanToggle.addEventListener('click', () => {
			toggleIndividualBranches();
		});
	} else {
		cleanToggle.disabled = true;
		cleanToggle.checked = false;
		cleanToggle.removeEventListener('click', toggleIndividualBranches);
	}
}

function toggleIndividualBranches() {
	let branches = document.getElementById('branches').querySelectorAll('input'); // all of the individual branches

	branches.forEach((branch) => {
		if (branch.disabled) {
			branch.removeAttribute('disabled');
		} else {
			if (!branch.checked)
				branch.disabled = true;
		}
	});
}

function toggleScheduleOption() {
	let dateToggle = document.getElementById('date-toggle');
	let dayToggles = document.querySelectorAll('.date-toggle-day');
	let timeToggles = document.querySelectorAll('.date-toggle-time');

	if (dateToggle.checked) {
		dayToggles.forEach((input) => {
			input.removeAttribute('disabled');
		});
	} else {
		disableTimeOptions(dayToggles, timeToggles);
	}
}

// dayToggles: array of all the day option checkbox elements
// timeToggles: array of all the time option checkbox elements
function disableTimeOptions(dayToggles, timeToggles) {
	uncheckOptions(dayToggles);
	uncheckOptions(timeToggles);
	dayToggles.forEach((input) => {
		input.disabled = true;
	});
}

// options: array of checkbox elements
function uncheckOptions(options) {
	options.forEach((input) => {
		input.checked = false;
	});
}

function toggleTimeCheckboxes() {
	let dayToggles = document.querySelectorAll('.date-toggle-day');
	let timeToggles = document.querySelectorAll('.date-toggle-time');
	let foundCheckedDay = false;

	if (timeToggles[0].disabled) {
		timeToggles.forEach((el) => {
			el.removeAttribute('disabled');
		});
	} else {
		dayToggles.forEach((el) => {
			if (el.checked)
				foundCheckedDay = true;
		})
		if (!foundCheckedDay) {
			timeToggles.forEach((dayEl) => {
				dayEl.setAttribute('disabled', 'true');
			});
		}
	}
}

function toggleEmailEntry() {
	let emailToggle = document.getElementById('emails-toggle');
	let emailInput = document.getElementById('emails');

	if (emailToggle.checked) {
		emailInput.disabled = false;
	} else {
		emailInput.disabled = true;
		emailInput.value = '';
	}
}

function displayWarning(message) {
	alert(message); // being lazy :p - will prettify it in the future
}
