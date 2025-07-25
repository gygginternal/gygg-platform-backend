const User = require('../models/User');
const Gig = require('../models/Gig');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');

/**
 * AI Matching Algorithm for Taskers and Providers
 * Matches based on hobbies, personalities, location, and other factors
 */

// Scoring weights for different matching criteria
const MATCHING_WEIGHTS = {
  hobbies: 0.3,
  location: 0.25,
  personality: 0.2,
  skills: 0.15,
  rating: 0.1
};

// Location scoring based on distance (in km)
const LOCATION_SCORING = {
  sameCity: 100,
  within10km: 90,
  within25km: 80,
  within50km: 70,
  within100km: 60,
  within200km: 40,
  beyond200km: 20
};

/**
 * Calculate similarity between two arrays using Jaccard similarity
 * @param {Array} arr1 - First array
 * @param {Array} arr2 - Second array
 * @returns {number} - Similarity score (0-1)
 */
const calculateJaccardSimilarity = (arr1, arr2) => {
  if (!arr1 || !arr2 || arr1.length === 0 || arr2.length === 0) return 0;
  
  const set1 = new Set(arr1.map(item => item.toLowerCase()));
  const set2 = new Set(arr2.map(item => item.toLowerCase()));
  
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  
  return intersection.size / union.size;
};

/**
 * Calculate location similarity based on address
 * @param {Object} address1 - First user's address
 * @param {Object} address2 - Second user's address
 * @returns {number} - Location score (0-100)
 */
const calculateLocationScore = (address1, address2) => {
  if (!address1 || !address2) return 0;
  
  // Same city gets highest score
  if (address1.city && address2.city && 
      address1.city.toLowerCase() === address2.city.toLowerCase()) {
    return LOCATION_SCORING.sameCity;
  }
  
  // Same state gets medium score
  if (address1.state && address2.state && 
      address1.state.toLowerCase() === address2.state.toLowerCase()) {
    return LOCATION_SCORING.within50km;
  }
  
  // Same country gets lower score
  if (address1.country && address2.country && 
      address1.country.toLowerCase() === address2.country.toLowerCase()) {
    return LOCATION_SCORING.within100km;
  }
  
  return LOCATION_SCORING.beyond200km;
};

/**
 * Calculate personality compatibility score
 * @param {Array} personality1 - First user's personality traits
 * @param {Array} personality2 - Second user's personality traits
 * @returns {number} - Personality score (0-100)
 */
const calculatePersonalityScore = (personality1, personality2) => {
  if (!personality1 || !personality2) return 50; // Neutral score if no data
  
  // Define complementary personality traits
  const complementaryTraits = {
    'organized': ['detail-oriented', 'punctual', 'reliable'],
    'creative': ['innovative', 'artistic', 'flexible'],
    'social': ['communicative', 'friendly', 'collaborative'],
    'analytical': ['logical', 'problem-solver', 'methodical'],
    'energetic': ['proactive', 'enthusiastic', 'dynamic']
  };
  
  let score = 0;
  let matches = 0;
  
  personality1.forEach(trait1 => {
    personality2.forEach(trait2 => {
      if (trait1.toLowerCase() === trait2.toLowerCase()) {
        score += 100; // Direct match
        matches++;
      } else if (complementaryTraits[trait1.toLowerCase()]?.includes(trait2.toLowerCase())) {
        score += 80; // Complementary trait
        matches++;
      }
    });
  });
  
  return matches > 0 ? score / matches : 50;
};

/**
 * Calculate overall matching score between two users
 * @param {Object} user1 - First user
 * @param {Object} user2 - Second user
 * @returns {Object} - Detailed matching score
 */
const calculateMatchingScore = (user1, user2) => {
  // Calculate individual scores
  const hobbiesScore = calculateJaccardSimilarity(user1.hobbies, user2.hobbies) * 100;
  const locationScore = calculateLocationScore(user1.address, user2.address);
  const personalityScore = calculatePersonalityScore(user1.personality, user2.personality);
  const skillsScore = calculateJaccardSimilarity(user1.skills, user2.skills) * 100;
  const ratingScore = (user2.rating || 4.0) * 20; // Convert 5-star rating to 100-point scale
  
  // Calculate weighted overall score
  const overallScore = (
    hobbiesScore * MATCHING_WEIGHTS.hobbies +
    locationScore * MATCHING_WEIGHTS.location +
    personalityScore * MATCHING_WEIGHTS.personality +
    skillsScore * MATCHING_WEIGHTS.skills +
    ratingScore * MATCHING_WEIGHTS.rating
  );
  
  return {
    overallScore: Math.round(overallScore),
    breakdown: {
      hobbies: Math.round(hobbiesScore),
      location: Math.round(locationScore),
      personality: Math.round(personalityScore),
      skills: Math.round(skillsScore),
      rating: Math.round(ratingScore)
    },
    matchReasons: generateMatchReasons(user1, user2, {
      hobbies: hobbiesScore,
      location: locationScore,
      personality: personalityScore,
      skills: skillsScore
    })
  };
};

/**
 * Generate human-readable match reasons
 * @param {Object} user1 - First user
 * @param {Object} user2 - Second user
 * @param {Object} scores - Individual scores
 * @returns {Array} - Array of match reasons
 */
const generateMatchReasons = (user1, user2, scores) => {
  const reasons = [];
  
  if (scores.hobbies > 30) {
    const commonHobbies = user1.hobbies?.filter(hobby => 
      user2.hobbies?.some(h => h.toLowerCase() === hobby.toLowerCase())
    ) || [];
    if (commonHobbies.length > 0) {
      reasons.push(`Shares ${commonHobbies.length} common hobbies: ${commonHobbies.slice(0, 2).join(', ')}`);
    }
  }
  
  if (scores.location > 70) {
    if (user1.address?.city === user2.address?.city) {
      reasons.push(`Both located in ${user1.address.city}`);
    } else if (user1.address?.state === user2.address?.state) {
      reasons.push(`Both in ${user1.address.state} area`);
    }
  }
  
  if (scores.skills > 40) {
    const commonSkills = user1.skills?.filter(skill => 
      user2.skills?.some(s => s.toLowerCase() === skill.toLowerCase())
    ) || [];
    if (commonSkills.length > 0) {
      reasons.push(`Compatible skills: ${commonSkills.slice(0, 2).join(', ')}`);
    }
  }
  
  if (user2.rating && user2.rating >= 4.5) {
    reasons.push(`Highly rated tasker (${user2.rating}/5.0)`);
  }
  
  return reasons;
};

/**
 * Find matching taskers for a provider
 * @param {string} providerId - Provider's ID
 * @param {Object} options - Matching options
 * @returns {Array} - Array of matched taskers with scores
 */
exports.findMatchingTaskers = catchAsync(async (req, res, next) => {
  const { providerId } = req.params;
  const { 
    limit = 20, 
    minScore = 50, 
    includeReasons = true,
    sortBy = 'score' 
  } = req.query;

  // Get provider details
  const provider = await User.findById(providerId).select(
    'hobbies skills address personality rating preferences'
  );
  
  if (!provider) {
    return next(new AppError('Provider not found', 404));
  }

  // Get all taskers
  const taskers = await User.find({
    role: { $in: ['tasker'] },
    _id: { $ne: providerId },
    isActive: true
  }).select(
    'firstName lastName profileImage hobbies skills address personality rating bio ratePerHour'
  );

  // Calculate matching scores for each tasker
  const matchedTaskers = taskers.map(tasker => {
    const matchData = calculateMatchingScore(provider, tasker);
    
    return {
      _id: tasker._id,
      firstName: tasker.firstName,
      lastName: tasker.lastName,
      profileImage: tasker.profileImage,
      bio: tasker.bio,
      rating: tasker.rating,
      ratePerHour: tasker.ratePerHour,
      hobbies: tasker.hobbies,
      skills: tasker.skills,
      address: tasker.address,
      matchScore: matchData.overallScore,
      matchBreakdown: matchData.breakdown,
      matchReasons: includeReasons ? matchData.matchReasons : undefined
    };
  });

  // Filter by minimum score and sort
  let filteredTaskers = matchedTaskers.filter(tasker => tasker.matchScore >= minScore);
  
  // Sort by specified criteria
  if (sortBy === 'score') {
    filteredTaskers.sort((a, b) => b.matchScore - a.matchScore);
  } else if (sortBy === 'rating') {
    filteredTaskers.sort((a, b) => (b.rating || 0) - (a.rating || 0));
  } else if (sortBy === 'rate') {
    filteredTaskers.sort((a, b) => (a.ratePerHour || 999) - (b.ratePerHour || 999));
  }

  // Limit results
  filteredTaskers = filteredTaskers.slice(0, parseInt(limit));

  res.status(200).json({
    status: 'success',
    results: filteredTaskers.length,
    data: {
      matches: filteredTaskers,
      provider: {
        id: provider._id,
        hobbies: provider.hobbies,
        skills: provider.skills,
        location: provider.address
      }
    }
  });
});

/**
 * Find matching providers for a tasker
 * @param {string} taskerId - Tasker's ID
 * @param {Object} options - Matching options
 * @returns {Array} - Array of matched providers with scores
 */
exports.findMatchingProviders = catchAsync(async (req, res, next) => {
  const { taskerId } = req.params;
  const { 
    limit = 20, 
    minScore = 50, 
    includeReasons = true,
    sortBy = 'score',
    hasActiveGigs = false 
  } = req.query;

  // Get tasker details
  const tasker = await User.findById(taskerId).select(
    'hobbies skills address personality rating preferences'
  );
  
  if (!tasker) {
    return next(new AppError('Tasker not found', 404));
  }

  // Build provider query
  let providerQuery = {
    role: { $in: ['provider'] },
    _id: { $ne: taskerId },
    isActive: true
  };

  // Get providers with optional active gigs filter
  let providers = await User.find(providerQuery).select(
    'firstName lastName profileImage hobbies skills address personality rating bio'
  );

  // If hasActiveGigs is true, filter providers with active gigs
  if (hasActiveGigs === 'true') {
    const activeGigs = await Gig.find({ 
      status: 'open',
      postedBy: { $in: providers.map(p => p._id) }
    }).select('postedBy');
    
    const providerIdsWithGigs = new Set(activeGigs.map(gig => gig.postedBy.toString()));
    providers = providers.filter(provider => providerIdsWithGigs.has(provider._id.toString()));
  }

  // Calculate matching scores for each provider
  const matchedProviders = providers.map(provider => {
    const matchData = calculateMatchingScore(tasker, provider);
    
    return {
      _id: provider._id,
      firstName: provider.firstName,
      lastName: provider.lastName,
      profileImage: provider.profileImage,
      bio: provider.bio,
      rating: provider.rating,
      hobbies: provider.hobbies,
      skills: provider.skills,
      address: provider.address,
      matchScore: matchData.overallScore,
      matchBreakdown: matchData.breakdown,
      matchReasons: includeReasons ? matchData.matchReasons : undefined
    };
  });

  // Filter by minimum score and sort
  let filteredProviders = matchedProviders.filter(provider => provider.matchScore >= minScore);
  
  // Sort by specified criteria
  if (sortBy === 'score') {
    filteredProviders.sort((a, b) => b.matchScore - a.matchScore);
  } else if (sortBy === 'rating') {
    filteredProviders.sort((a, b) => (b.rating || 0) - (a.rating || 0));
  }

  // Limit results
  filteredProviders = filteredProviders.slice(0, parseInt(limit));

  res.status(200).json({
    status: 'success',
    results: filteredProviders.length,
    data: {
      matches: filteredProviders,
      tasker: {
        id: tasker._id,
        hobbies: tasker.hobbies,
        skills: tasker.skills,
        location: tasker.address
      }
    }
  });
});

/**
 * Get matching statistics and insights
 */
exports.getMatchingInsights = catchAsync(async (req, res, next) => {
  const { userId } = req.params;
  
  const user = await User.findById(userId);
  if (!user) {
    return next(new AppError('User not found', 404));
  }

  const isProvider = user.role.includes('provider');
  const targetRole = isProvider ? 'tasker' : 'provider';
  
  // Get all potential matches
  const potentialMatches = await User.find({
    role: { $in: [targetRole] },
    _id: { $ne: userId },
    isActive: true
  }).select('hobbies skills address personality rating');

  // Calculate statistics
  const scores = potentialMatches.map(match => 
    calculateMatchingScore(user, match).overallScore
  );

  const insights = {
    totalPotentialMatches: potentialMatches.length,
    averageMatchScore: scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
    highQualityMatches: scores.filter(score => score >= 80).length,
    goodMatches: scores.filter(score => score >= 60 && score < 80).length,
    averageMatches: scores.filter(score => score >= 40 && score < 60).length,
    recommendations: generateRecommendations(user, scores)
  };

  res.status(200).json({
    status: 'success',
    data: {
      insights,
      userProfile: {
        hobbies: user.hobbies?.length || 0,
        skills: user.skills?.length || 0,
        hasLocation: !!(user.address?.city),
        hasPersonality: !!(user.personality?.length)
      }
    }
  });
});

/**
 * Generate recommendations for improving match scores
 */
const generateRecommendations = (user, scores) => {
  const recommendations = [];
  const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  
  if (!user.hobbies || user.hobbies.length < 3) {
    recommendations.push({
      type: 'hobbies',
      message: 'Add more hobbies to your profile to improve matching',
      impact: 'high'
    });
  }
  
  if (!user.address?.city) {
    recommendations.push({
      type: 'location',
      message: 'Add your location to find nearby matches',
      impact: 'high'
    });
  }
  
  if (!user.skills || user.skills.length < 5) {
    recommendations.push({
      type: 'skills',
      message: 'Add more skills to showcase your capabilities',
      impact: 'medium'
    });
  }
  
  if (avgScore < 50) {
    recommendations.push({
      type: 'profile',
      message: 'Complete your profile to improve match quality',
      impact: 'high'
    });
  }
  
  return recommendations;
};

/**
 * Batch match multiple users (for admin/analytics)
 */
exports.batchMatch = catchAsync(async (req, res, next) => {
  const { userIds, targetRole = 'tasker' } = req.body;
  
  if (!userIds || !Array.isArray(userIds)) {
    return next(new AppError('Please provide an array of user IDs', 400));
  }

  const users = await User.find({ _id: { $in: userIds } });
  const targets = await User.find({ 
    role: { $in: [targetRole] },
    _id: { $nin: userIds },
    isActive: true 
  });

  const batchResults = users.map(user => {
    const matches = targets.map(target => ({
      targetId: target._id,
      targetName: `${target.firstName} ${target.lastName}`,
      matchScore: calculateMatchingScore(user, target).overallScore
    })).sort((a, b) => b.matchScore - a.matchScore).slice(0, 5);

    return {
      userId: user._id,
      userName: `${user.firstName} ${user.lastName}`,
      topMatches: matches
    };
  });

  res.status(200).json({
    status: 'success',
    data: {
      batchResults
    }
  });
});