var config = require('../config');

var Maki = require('maki');
var hive = new Maki(config);

var Passport = require('maki-passport-local');
var passport = new Passport({
  resource: 'Person'
});

var Auth = require('maki-auth-simple');
var auth = new Auth({
  resource: 'Person',
  capabilities: {
    'queue': ['*'],
    'manage': ['admin']
  }
});

hive.use(passport);
hive.use(auth);

var Person   = hive.define('Person',   require('../resources/person'));
var Category = hive.define('Category', require('../resources/category'));
var Channel  = hive.define('Channel',  require('../resources/channel'));
var Key      = hive.define('Key',      require('../resources/key'));
var Search   = hive.define('Search',   require('../resources/search'));
var Source   = hive.define('Source',   require('../resources/source'));
var Track    = hive.define('Track',    require('../resources/track'));
var Peer     = hive.define('Peer',     require('../resources/peer'));
var Play     = hive.define('Play',     require('../resources/play'));
var Playlist = hive.define('Playlist', require('../resources/playlist'));

Search.post('create', function(next, cb) {
  var search = this;
  var youtube = require('../lib/youtube');
  
  youtube.search.list({
    part: 'snippet',
    q: search.query
  }, function(err, results) {
    if (err) console.log('error retrieving youtube:', err);
    if (results && results.items && results.items.length) {
      results.items.forEach(function(item) {

        var video = {
          type: 'youtube',
          id: item.id.videoId,
          title: item.snippet.title,
          images: {
            thumbnail: {
              url: item.snippet.thumbnails.high.url
            }
          }
        }

        Source.create(video, function(err, source) {
          if (err) return console.log('error creating source:', err);
          Search.Model.update({ _id: search._id }, {
            $addToSet: { _sources: source._id }
          }, new Function());
        });
      });
    }
  });

  next();
});

// update the room if no track is playing.  start the music!
Play.post('create', function(next, cb) {
  var play = this;
  if (play.state === 'queued') {
    Channel.Model.findOne({ _id: play._channel }).exec(function(err, channel) {
      return channel.advanceToPlay(play);
    });
  }
  next();
});

Source.post('create', function(next, cb) {
  var source = this;
  var youtube = require('../lib/youtube');
  var moment = require('moment');
  
  console.log('source created, ', source);
  // TODO: crawl it.  use the worker!
  // TODO: create the worker.
  // TODO: upsert
  Track.create({
    title: source.title || 'Unknown',
    duration: source.duration || 15,
    
    _sources: [ source._id ]
  }, function(err, track) {
    console.log('track created,', err || track);
    
    youtube.videos.list({
      part: 'contentDetails',
      id: source.id
    }, function(err, results) {
      if (err) console.log(err);
      
      if (results && results.items && results.items.length) {
        results.items.forEach(function(item) {
          console.log(item);
          var duration = moment.duration(item.contentDetails.duration).as('seconds');
          
          console.log('duration:', duration);
          
          Source.patch({
            _id: source._id
          }, [
            { op: 'add', path: '/duration', value: duration },
            { op: 'replace', path: '/duration', value: duration }
          ], function(err, sources) {
            console.log('duration edited:', err, sources);
          });
          
          // TODO: make smarter by not always running against the tracks
          // really this is only for NKO
          Track.patch({
            _sources: source._id
          }, [
            { op: 'add', path: '/duration', value: duration },
            { op: 'replace', path: '/duration', value: duration },
          ], function(err, tracks) {
            console.log('duration edited:', err, tracks);
          });
          
          Track.Model.update({
            _sources: source._id,
            'images.thumbnail.url': null
          }, {
            $set: {
              images: source.images
            }
          }, function(err, num) {
            console.log('heyyyy thumbnails', err, num);
          });
          
        });
      }
    });
    
    // gross.  what is taking the rest of the stack so long?
    setTimeout(function() {
      console.log('updating relevant searches...');
      Search.Model.update({
        _sources: source._id
      }, {
        $addToSet: { results: track._id }
      }, function(err, num) {
        console.log('searches updated:', err, num);
      });
    }, 250);

    next();
  });
});

hive.Messenger.prototype.publish = function( channel , message ) {
  var self = this;
  var async = require('async');
  
  // if only this were smalltalk.
  //this.emit('message', channel , message );
  //this._backbone.broadcast( channel , message );

  if (channel.substr(0, 10) === '/channels/') {
    var ops = JSON.parse(message);
    async.map(ops, function(op, next) {

      if (op.path === '/_play') {
        Play.Model.populate(op, {
          path: 'value'
        }, function(err, otherOp) {
          console.log('populated:', err, otherOp);
          next(err, otherOp);
        });
      }
      
      if (op.path === '/_track') {
        Track.Model.populate(op, {
          path: 'value'
        }, function(err, otherOp) {
          console.log('populated:', err, otherOp);
          next(err, otherOp);
        });
      }

    }, function(err, results) {
      results = JSON.stringify(results);
      self.emit('message', channel , results );
      self._backbone.broadcast( channel , results );
    });
  } else {
    this.emit('message', channel , message );
    this._backbone.broadcast( channel , message );
  }
  
};

module.exports = hive;
