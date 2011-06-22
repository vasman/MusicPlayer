(function(app){

	function TrackWidget(player, index, track) {
		var me = this;
		me.player = player;
		var altsCount = 0;


		var trCache = JSON.parse(localStorage.getItem('tracksCache') || '{}');
		if(track.id in trCache) {
			altsCount = trCache[track.id].tracks.length;
		}

		var $el = me.$element = $('<div />', {
			id:'track-widget-' + track.id,
			'class' : 'track-widget ' + (index%2===0?'odd':'even'),
			title : track.artist + ' - ' + track.title
		}).append(
				$('<span/>', {'class':'number', text:(index + 1) + '. '}),
				track.artist + ' - ' + track.title,
				$('<span/>', {'class':'on', text:altsCount>1?altsCount:'ON'}).click(function(){
					var tracksCache = JSON.parse(localStorage.getItem('tracksCache') || '{}');
					if(track.id in tracksCache && tracksCache[track.id].tracks.length>1) {
						tracksCache[track.id].tracks.push(tracksCache[track.id].tracks.shift());
						localStorage.setItem('tracksCache', JSON.stringify(tracksCache));
						player.play(track.id, false);
					}
				})
				);
		$el.trackWidget = me;

		if(index+1 == player.playList.length) {
			$el.addClass('last');
		}

		$el.bind({
			click : function(){
				player.play(track.id);
			},
			addedToDom : function(ev) {
				ev.stopPropagation();
			},
			mousedown : function(){ $(this).addClass('down'); },
			mouseup : function(){ $(this).removeClass('down'); }
		});


		player.bind('play.trackWidget', function onPlay(ev, ptrack) {
			me.setPlaying(track.id == ptrack.id);
		});
		player.bind('pause.trackWidget', function onPlay(ev, trackId) {
			if(track.id == trackId) {
				me.setPaused(false);
			}
		});
		player.bind('trackError.trackWidget', function onTrackError(ev, trackId, err) {
			if(track.id == trackId) {
				me.setError(err);
			}
		});

		me.setPlaying(track.id==player.currentTrackId);
		me.setError(player.trackErrors[track.id]);
	}
	TrackWidget.prototype.setPaused = function() {
		this.$element.addClass('paused');
	};
	TrackWidget.prototype.setPlaying = function(isPlaying) {
		this.$element.removeClass('paused').toggleClass('playing', isPlaying);
	};
	TrackWidget.prototype.setError = function(err) {
		var me = this;
		me.$element.toggleClass('error', err ? true : false).prop('title', err ? err.message : me.$element.attr('title'));
	};

	app.classes.TrackWidget = TrackWidget;

})(ChromePlayer);