var _ = require('underscore');
var validator = require('validator');
var async = require('async');
// TODO var tagUtils = require('./tag');

module.exports = {

  /**
   * Fetch usersettings
   *
   * @param userId
   * @param done call back, returns settings as an object ( settings.key=obj )
   *             this way properties are accesible thusly settings.supervisorEmail.value
   *             and they can be deleted easily because the id is present
   */
  getUserSettings: function (userId, done){
    var userSetting = {};

    UserSetting.findByUserId(userId)
      .exec(function(err,settings){
        if (err) { return done(err, null); }
        _.each(settings,function(setting){
          userSetting[setting.key]=setting;
        });

        return done(null,userSetting);
      });
  },

  /**
   * Handle the case where a user forgets their password
   *
   * @param email the email address of the user
   * @param cb callback of the form cb(err);
   */
  forgotPassword: function (email, cb) {
    email = email.toLowerCase().trim();
    // check if this is a valid email address
    if (validator.isEmail(email) !== true) {
      return cb({ message: 'Please enter a valid email address.' }, {});
    }
    User.findOneByUsername(email, function (err, user) {
      // if there's no matching email address, don't provide the user feedback.
      // make it look like success
      if (err || !user) {
        return cb(null, {});
      }
      var token = {
        userId: user.id
        // token is auto-generated by the model
      };
      UserPasswordReset.create(token, function (err, newToken) {
        if (err) {
          return cb({
            message: 'Error creating a reset password token.',
            err: err
          });
        }
        // pass the token back
        cb(err, newToken);
      });
    });
  },

  /**
   * Check if a token is a valid token for resetting a user's password.
   *
   * @return cb of the form (err, true if valid, token object)
   */
  checkToken: function (token, cb) {
    token = token.toLowerCase().trim();
    // compute the maximum token expiration time
    var expiry = new Date();
    expiry.setTime(expiry.getTime() - sails.config.auth.auth.local.tokenExpiration);
    UserPasswordReset.find()
    .where({ token: token })
    .where({ createdAt:
      {
        '>': expiry
      }
    })
    .exec(function (err, tokens) {
      if (err) { return cb(err, false, null); }
      var valid = false;
      var validToken = null;
      for (var i in tokens) {
        if (tokens[i].token == token) {
          valid = true;
          validToken = tokens[i];
          break;
        }
      }
      cb(null, valid, validToken);
    });
  },

  /**
   * Clean fields from a user object that might
   * be sensitive.
   * @param user the user object to clean
   * @return a new user object
   */
  cleanUser: function (user, reqId) {
    var u = {
          id: user.id,
          username: user.username,
          name: user.name,
          title: user.title,
          bio: user.bio,
          tags: user.tags,
          badges: user.badges,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt
      };
    // if the requestor is the same as the user, show admin status
    if (user.id === reqId) {
      u.isAdmin = user.isAdmin;
    }
    return u;
  },

  /**
   * Gets all the information about a user.
   *
   * @param userId: the id of the user to query
   * @param reqId: the requester's id
   */
  getUser: function (userId, reqId, reqUser, cb) {
    var self = this,
        admin = (reqUser && reqUser[0] && reqUser[0].isAdmin) ? true : false;
    if (!_.isFinite(userId)) {
      return cb({ message: 'User ID must be a numeric value' }, null);
    }
    if (typeof reqUser === 'function') {
      cb = reqUser;
      reqUser = undefined;
    }
    User.findOne({ id: userId })
      .populate('tags').populate('passports').populate('badges')
      .exec(function (err, user) {
        if (err || !user) { return cb("Error finding User.", null); }
        delete user.deletedAt;
        user.badges = user.badges.map(function(b) {
          b.description = b.getDescription();
          return b;
        });
        if (userId != reqId) {
          user = self.cleanUser(user, reqId);
        }
        user.location = _.findWhere(user.tags, { type: 'location' });
        user.agency = _.findWhere(user.tags, { type: 'agency' });
        Like.countByTargetId(userId, function (err, likes) {
          if (err) { return cb(err, null); }
          user.likeCount = likes;
          user.like = false;
          user.isOwner = false;
          Like.findOne({ where: { userId: reqId, targetId: userId }}, function (err, like) {
            if (err) { return cb(err, null); }
            if (like) { user.like = true; }

            // stop here if the requester id is not the same as the user id
            if (userId != reqId && !admin) return cb(null, user);

            user.isOwner = true;

            // Look up which providers the user has authorized
            user.auths = [];
            user.auths = _(user.passports).chain().filter(function(passport) {
              return passport.provider && !passport.deletedAt;
            }).map(function(passport) {
              return {
                provider: passport.provider,
                id: passport.id,
                token: passport.accessToken || passport.tokens.accessToken
              };
            }).value();

            return cb(null, user);
          });
        });

    });
  },

  /**
   * Look up the name of a user and include it in the originating object.
   * The user's name is stored in the originating object.
   * @param user an object that includes userId for the user
   * @param done called when finished with syntax done(err).
   */
  addUserName: function (ownerObj, done) {
    User.findOneById(ownerObj.userId, function (err, owner) {
      if (err) { return done(err); }
      if (!owner) { return done(); }
      ownerObj.name = owner.name;
      return done();
    });
  },

  /**
   * Validate a password based on OWASP password rules.
   * @param username the user's name or email
   * @param password the user's proposed password
   * @return an object returning keys set to true where the rule passes,
   *         false if the rule failed.
   */
  validatePassword: function (username, password) {
    var rules = {
      username: false,
      length: false,
      upper: false,
      lower: false,
      number: false,
      symbol: false
    };
    var _username = username.toLowerCase().trim();
    var _password = password.toLowerCase().trim();
    // check username is not the same as the password, in any case
    if (_username != _password && _username.split('@',1)[0] != _password) {
      rules.username = true;
    }
    // length > 8 characters
    if (password && password.length >= 8) {
      rules.length = true;
    }
    // Uppercase, Lowercase, and Numbers
    for (var i = 0; i < password.length; i++) {
      var test = password.charAt(i);
      // from http://stackoverflow.com/questions/3816905/checking-if-a-string-starts-with-a-lowercase-letter
      if (test === test.toLowerCase() && test !== test.toUpperCase()) {
        // lowercase found
        rules.lower = true;
      }
      else if (test === test.toUpperCase() && test !== test.toLowerCase()) {
        rules.upper = true;
      }
      // from http://stackoverflow.com/questions/18082/validate-numbers-in-javascript-isnumeric
      else if (!isNaN(parseFloat(test)) && isFinite(test)) {
        rules.number = true;
      }
    }
    // check for symbols
    if (/.*[^\w\s].*/.test(password)) {
      rules.symbol = true;
    }
    return rules;
  }
};
