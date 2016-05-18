/* jshint -W106 */
'use strict';

const POLL_INTERVAL = 60 * 1000;
const PRIZES_URL = 'https://gamesdonequick.com/tracker/search/?type=prize&event=17';
const CURRENT_PRIZES_URL = 'https://gamesdonequick.com/tracker/search/?type=prize&feed=current&event=17';
// const PRIZES_URL = 'https://dl.dropboxusercontent.com/u/6089084/agdq_mock/allPrizes.json';
// const CURRENT_PRIZES_URL = 'https://dl.dropboxusercontent.com/u/6089084/agdq_mock/currentPrizes.json';

const Q = require('q');
const request = require('request');
const equal = require('deep-equal');
const numeral = require('numeral');

module.exports = function (nodecg) {
	const currentPrizes = nodecg.Replicant('currentPrizes', {defaultValue: []});
	const allPrizes = nodecg.Replicant('allPrizes', {defaultValue: []});

	// Get initial data
	update();

	// Get latest prize data every POLL_INTERVAL milliseconds
	nodecg.log.info('Polling prizes every %d seconds...', POLL_INTERVAL / 1000);
	let updateInterval = setInterval(update.bind(this), POLL_INTERVAL);

	// Dashboard can invoke manual updates
	nodecg.listenFor('updatePrizes', function (data, cb) {
		nodecg.log.info('Manual prize update button pressed, invoking update...');
		clearInterval(updateInterval);
		updateInterval = setInterval(update.bind(this), POLL_INTERVAL);
		update()
			.spread((updatedCurrent, updatedAll) => {
				const updatedEither = updatedCurrent || updatedAll;
				if (updatedEither) {
					nodecg.log.info('Prizes successfully updated');
				} else {
					nodecg.log.info('Prizes unchanged, not updated');
				}

				cb(null, updatedEither);
			}, error => {
				cb(error);
			});
	});

	function update() {
		const currentPromise = Q.defer();
		request(CURRENT_PRIZES_URL, (err, res, body) => {
			handleResponse(err, res, body, currentPromise, {
				label: 'current prizes',
				replicant: currentPrizes
			});
		});

		const allPromise = Q.defer();
		request(PRIZES_URL, (err, res, body) => {
			handleResponse(err, res, body, allPromise, {
				label: 'all prizes',
				replicant: allPrizes
			});
		});

		return Q.all([
			currentPromise.promise,
			allPromise.promise
		]);
	}

	function handleResponse(error, response, body, deferred, opts) {
		if (!error && response.statusCode === 200) {
			let prizes;
			try {
				prizes = JSON.parse(body);
			} catch (e) {
				nodecg.log.error('Could not parse %s, response not valid JSON:\n\t', opts.label, body);
				return;
			}

			// The response we get has a tremendous amount of cruft that we just don't need. We filter that out.
			const relevantData = prizes.map(formatPrize);

			if (equal(relevantData, opts.replicant.value)) {
				deferred.resolve(false);
			} else {
				opts.replicant.value = relevantData;
				deferred.resolve(true);
			}
		} else {
			let msg = `Could not get ${opts.label}, unknown error`;
			if (error) {
				msg = `Could not get ${opts.label}:\n${error.message}`;
			} else if (response) {
				msg = `Could not get ${opts.label}, response code ${response.statusCode}`;
			}

			nodecg.log.error(msg);
			deferred.reject(msg);
		}
	}

	function formatPrize(prize) {
		return {
			name: prize.fields.name,
			provided: prize.fields.provider,
			description: prize.fields.shortdescription || prize.fields.name,
			image: prize.fields.altimage,
			minimumbid: numeral(prize.fields.minimumbid).format('$0,0[.]00'),
			grand: prize.fields.category__name === 'Grand',
			type: 'prize'
		};
	}
};
