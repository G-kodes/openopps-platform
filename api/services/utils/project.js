/**
 * Determine if a user has access to project
 * Callback: function(err, proj)
 * If both err and proj are null, then project
 * was found but access is denied.
 */
var authorized = function (id, userId, cb) {
  Project.findOneById(id, function (err, proj) {
    if (err) { return cb('Error finding project.', null); }
    // otherwise, check that we have an owner
    ProjectOwner.findByProjectId(proj.id, function(err, owners) {
      if (err) { return cb('Error looking up owners.', null); }
      proj.owners = [];
      proj.isOwner = false;
      for (var i = 0; i < owners.length; i++) {
        if (userId && (owners[i].userId == userId)) { proj.isOwner = true; }
        proj.owners.push({ id: owners[i].id, userId: owners[i].userId });
      }
      // If project is public or public and closed/finished, continue
      if ((proj.state === 'public') || (proj.state === 'closed') || (proj.isOwner)) {
        return cb(null, proj);
      }
      else {
        return cb(null, null);
      }
    });
  });
};

var getMetadata = function(proj, user, cb) {
  proj.like = false;
  Like.countByProjectId( proj.id, function (err, likes) {
    if (err) { return cb(err, proj); }
    proj.likeCount = likes;
    if (!user) {
      return cb(null, proj);
    }
    Like.findOne({ where: { userId: user.id, projectId: proj.id }}, function (err, like) {
      if (err) { return cb(err, proj); }
      if (like) { proj.like = true; }
      return cb(null, proj);
    });
  });
};

module.exports = {
  getMetadata: getMetadata,
  authorized: authorized
};
