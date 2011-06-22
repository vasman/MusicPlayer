(function(app){

	var LASTFM_API_KEY = 'b6ee0c125425b77a1d35c95e1ac7647c';
	var LASTFM_API_SECRET = 'bc88fab51c9bc69376bfaece2566dada';

	var VK_APP_ID = "2387324";

	var i18n = chrome.i18n;
	var button = app.classes.Button;
	var LastFmApi = app.classes.LastFmApi;
	var VKApi = app.classes.VKApi;

	var cbk = app.cbk;

	function Player() {
		var me = this;

		if(localStorage.getItem('lastFmSessionKey')) {
			me.lastFm = new LastFmApi(localStorage.getItem('lastFmSessionKey'), LASTFM_API_KEY, LASTFM_API_SECRET);
		}

		if(localStorage.getItem('vkSessionAccessToken')) {
			if(localStorage.getItem('vkSessionExpires') > Date.now()) {
				me.vk = new VKApi(localStorage.getItem('vkSessionAccessToken'), localStorage.getItem('vkSessionUserId'), VK_APP_ID);
			}
		}

		me.scrobblingEnabled = localStorage.getItem('lastFmScrobblingEnabled') && me.lastFm !== undefined;

		me.playList = [];
		me.playListIndex = {};
		me.trackErrors = {};
		me.currentTrackId = undefined;
		me.currentTime = 0;
		me.currentDuration = 0;
		me.currentProgress = 0;
		me.cache = {};
		me.currentState = 'stopped';

		//TODO: Start and stop progress checking only when needed
		me.progressInterval = setInterval(function(){
			me.checkProgress();
		}, 1000);
	}
	Player.prototype.loadPlayList = function (playList, callback){
		if(!playList) {
			playList = [];
		}
		var me = this;
		this.stop(function(err){
			if(!err) {

				me.playList = [];
				me.playListIndex = {};
				me.trackErrors = {};
				me.currentTrackId = undefined;
				me.currentTime = 0;
				me.currentDuration = 0;
				me.currentProgress = 0;
				me.currentState = 'stopped';

				if(playList && playList.length) {

					for(var ti=0;ti<playList.length; ti++) {
						var track = playList[ti];
						if(!(track.id in me.playListIndex)) {
							me.playList.push(track);
							me.playListIndex[track.id] = me.playList.length -1;
						}
					}

					button.setBadgeText(playList.length.toString());
					button.setBadgeBackgroundColor(0,0,255,100);
				}
				console.log('Loaded playlist with %s tracks', me.playList.length);
				me.trigger('playList');
				cbk(callback);
			} else {
				cbk(callback, err)
			}
		});
	};
	Player.prototype.getTrack = function (trackId){
		if(!this.playList || !(trackId in this.playListIndex)) {
			return;
		}
		return this.playList[this.playListIndex[trackId]];
	};
	Player.prototype.getTrackIndex = function(trackId) {
		if(!this.playList || !(trackId in this.playListIndex)) {
			return;
		}
		return this.playListIndex[trackId];
	};
	Player.prototype.next = function(currentTrackId, callback) {
		if(!currentTrackId && this.playList) {
			this.play(this.playList[0].id, true, callback);
			return;
		} else if(currentTrackId && this.playList) {
			for(var i=0;i<this.playList.length;i++) {
				if(this.playList[i].id == currentTrackId) {
					if(this.playList[i+1] !== undefined) {
						this.play(this.playList[i+1].id, true, callback);
						return;
					}
				}
			}
		}

		console.log('No other tracks to play');
		cbk(callback, new Error(i18n.getMessage('nothingToPlay')));
	};
	Player.prototype.play = function (trackId, isNext, callback){
		var me = this;
		if(!me.playList) {
			cbk(callback, new Error(i18n.getMessage('nothingToPlay')));
		}

		if(isNext === undefined) {
			isNext = false;
		} else if (isNext instanceof Function) {
			isNext = false;
			callback = isNext;
		}

		var track = me.getTrack(trackId);

		if(!track) {
			var err = new Error(i18n.getMessage('trackNotInPlaylist', [trackId]));
			me.trigger('trackError', [trackId, err]);
			cbk(callback, err);
		}

		track.scrobbled = false;

		var tracksCache = JSON.parse(localStorage.getItem('tracksCache') || '{}');

		//find song
		function vkResponse(tracks) {
			//TODO: CLEAN CACHE ONCE IN A WHILE
			tracksCache[trackId] = {
				time : Date.now,
				tracks : tracks
			};

			localStorage.setItem('tracksCache', JSON.stringify(tracksCache));

			if(tracks && tracks.length>0) {
				$('#audio').unbind();
				$('#player').empty();

				var $aud = $('<audio />', {id:'audio'}).append($('<source />', { src:tracks[0].url, 'type':'audio/mpeg' }));

				$aud.bind('canplaythrough', function(){
					$aud.get(0).play();
					cbk(callback);
					me.checkProgress();
				});
				$aud.bind('play', function(){
					console.log('Playing \'%s - %s\' (have %s mp3s)', track.artist,  track.title, tracks.length);
					me.currentState = 'playing';
					me.trigger('play', [track, isNext]);
					me.checkProgress();
					if(me.scrobblingEnabled) {
						me.lastFm.setNowPlaying(track.artist, track.title, undefined, me.currentDuration > 30 ? me.currentDuration : undefined, function(err) {
							if(!err) {
								console.log("Track is marked as 'now playing': %s", trackId);
								me.trigger('trackSetNowPlaying', [trackId]);
							} else {
								console.log("Failed to mark track as 'now playing': %s", err.message);
							}
						});
					}
				});
				$aud.bind('pause', function(){
					me.currentState = 'paused';
					me.trigger('pause', [trackId]);
				});
				$aud.bind('ended', function(){
					var curr = me.currentState;
					me.currentState = 'stopped';
					me.currentTrackId = undefined;
					if(curr=='playing') {
						me.playNextAvailable(trackId);
					}
				});
				$aud.bind('durationchange', function(){
					me.currentDuration = $aud.get(0).duration;
					me.trigger('durationChange', [me.currentDuration]);
				});
				$aud.bind('timeupdate', function(){
					me.currentTime = $aud.get(0).currentTime;
					
					if(me.scrobblingEnabled && $aud.get(0).HAVE_METADATA && me.currentDuration>30) {
						if(((me.currentTime / me.currentDuration)*100) > 30 && !track.scrobbled){
							track.scrobbled = true;
							me.lastFm.scrobble(track.artist, track.title, undefined, me.currentDuration, function(err) {
								if(!err) {
									console.log("Track scrobbled: %s", trackId);
									me.trigger('trackScrobbled', [trackId]);
								} else {
									console.log("Failed to scrobble track: %s", err.message);
								}
							});
						}
					}

					me.trigger('timeUpdate', [me.currentTime]);
				});
				$aud.bind('progress', function(){
					me.checkProgress();
				});

				me.currentTrackId = trackId;

				button.setBadgeText((me.playListIndex[trackId]+1) + '/' + me.playList.length.toString());
				button.setToolTip(i18n.getMessage('extToolTipPlaying', [track.artist, track.title]));

				$('#player').append($aud);
			} else {
				console.log('No mp3s found for \'%s - %s\'', track.artist,  track.title);
				var err = new Error(i18n.getMessage('noMp3sForTrack', [track.artist, track.title]));
				err.trackId = trackId;
				me.trackErrors[trackId] = err;
				me.trigger('trackError', [trackId, err]);
				cbk(callback, err);
			}
		}

		if(trackId in tracksCache) {
			vkResponse(tracksCache[trackId].tracks);
		} else {
			if(me.vk) {
				me.vk.searchSongs(track.artist, track.title, function(err,data){
					if(data) {
						vkResponse(data);
					}
				})
			} else {
				//TODO: VK AUTH
			}
		}
	};
	Player.prototype.pause = function(callback){
		if($('#audio').size()>0) {
			$('#audio')[0].pause();
		}

		cbk(callback);
	};
	Player.prototype.resume = function(callback) {
		var me = this;
		if(me.currentTrackId !== undefined) {
			$('#audio').get(0).play();
			cbk(callback);
		} else if(me.playList && me.playList.length) {
			me.playNextAvailable(null, callback);
		}
	};
	Player.prototype.playNextAvailable = function(currentTrackId, callback) {
		var me = this;

		function tryNext(err) {
			//if next track was not found, try the next one
			if(err && err.trackId) {
				me.next(err.trackId, tryNext);
			} else {
				cbk(callback, err);
			}
		}

		me.next(currentTrackId, tryNext);
	};
	Player.prototype.stop = function(callback){
		button.setToolTip(i18n.getMessage("extToolTip"));
		if(this.currentTrackId !== undefined && !$('#audio').get(0).paused) {
			$('#audio').one('pause', function() {
				cbk(callback);
			});
			$('#audio').get(0).pause();
		} else {
			cbk(callback);
		}
	};
	Player.prototype.seek = function(time, callback){
		var me = this;
		if(time<=me.currentProgress) {
			$('#audio').get(0).currentTime = time;
		}
		cbk(callback);
	};
	Player.prototype.checkProgress = function() {
		var me = this;
		var $aud = $('#audio');
		if($aud.size() && $aud.get(0).buffered.length > 0) {
			var oldProgress = me.currentProgress;
			me.currentProgress = $aud.get(0).buffered.end($aud.get(0).buffered.length-1);
			if(me.currentProgress!=oldProgress) {
				me.trigger('progress', [me.currentProgress]);
			}
		}
	};

	Player.prototype.vkAuth = function(callback){
		var me = this;

		VKApi.getSession(VK_APP_ID, function(err, sess){
			if(!err) {
				localStorage.setItem('vkSessionAccessToken', sess.accessToken);
				localStorage.setItem('vkSessionExpires', Date.now() + sess.expiresIn);
				localStorage.setItem('vkSessionUserId', sess.userId);
				me.vk = new VKApi(sess.accessToken, sess.userId, VK_APP_ID);
				me.trigger('vkAuthChanged');
				cbk(callback, sess);
			} else {
				console.error(err);
				cbk(callback, err);
			}
		});
	};

	Player.prototype.toggleScrobbling = function(enable, callback) {
		var me = this;
		if(enable) {
			if(localStorage.getItem('lastFmSessionKey')!==null) {
				localStorage.setItem('lastFmScrobblingEnabled', true);
				me.lastFm = new LastFmApi(localStorage.getItem('lastFmSessionKey'), LASTFM_API_KEY, LASTFM_API_SECRET);
				me.scrobblingEnabled = true;
				me.trigger('scrobblingEnabled');
				cbk(callback);
			} else {
				LastFmApi.getToken(LASTFM_API_KEY, LASTFM_API_SECRET, function(err,token){
					LastFmApi.authToken(LASTFM_API_KEY, token, function(err) {
						LastFmApi.getSession(LASTFM_API_KEY, LASTFM_API_SECRET, token, function(err,sess) {
							localStorage.setItem('lastFmSessionKey', sess.key);
							localStorage.setItem('lastFmSessionUserName', sess.name);
							localStorage.setItem('lastFmSessionSubscriber', sess.subscriber);
							me.toggleScrobbling(true, callback);
						});
					})
				});
			}
		} else {
			me.scrobblingEnabled = false;
			localStorage.setItem('lastFmScrobblingEnabled', false);
			me.trigger('scrobblingDisabled');
			cbk(callback);
		}
	};

	Player.prototype.loveTrack = function(trackId, callback) {
		var me = this;
		var track = me.getTrack(trackId);
		if(track) {
			if(me.lastFm) {
				me.lastFm.loveTrack(track.artist, track.title, function(err){
					if(!err) {
						console.log("Track loved: %s", trackId);
						me.trigger('trackLoved', [trackId]);
						cbk(callback);
					} else {
						console.log("Failed to love track: %s", err.message);
						cbk(callback, err);
					}
				});
			} else {
				cbk(callback, new Error('LastFM is not authorized'));
			}
		} else {
			cbk(callback, new Error('No track to love'));
		}
	};

	Player.prototype.bind = function(eventType, handler) {
		$(window).bind(eventType, handler);
	};
	Player.prototype.unbind = function(eventType, handler) {
		$(window).unbind(eventType, handler);
	};
	Player.prototype.trigger = function(eventType, extraParams) {
		try{
			$(window).trigger(eventType, extraParams);
		} catch(e) {

		}
	};

	app.classes.Player = new Player();

})(ChromePlayer);