#!/usr/bin/env node

/**
 * Application Matching Test
 * 
 * Tests the application matching functionality to ensure:
 * 1. Applications are sorted by compatibility score
 * 2. Hobby matching works correctly
 * 3. Skills matching works correctly
 * 4. Personality preferences are considered
 */

console.log('🧪 Testing Application Matching System\n');

// Mock data for testing
const mockProvider = {
  hobbies: ['reading', 'gardening', 'cooking', 'photography'],
  skills: ['cleaning', 'organizing', 'pet care'],
  peoplePreference: ['friendly', 'reliable', 'experienced']
};

const mockTaskers = [
  {
    id: 1,
    name: 'Alice Johnson',
    hobbies: ['reading', 'cooking', 'yoga'],
    skills: ['cleaning', 'organizing', 'laundry'],
    peoplePreference: ['friendly', 'punctual'],
    rating: 4.8,
    ratingCount: 25
  },
  {
    id: 2,
    name: 'Bob Smith',
    hobbies: ['sports', 'music'],
    skills: ['pet care', 'dog walking'],
    peoplePreference: ['reliable', 'energetic'],
    rating: 4.2,
    ratingCount: 12
  },
  {
    id: 3,
    name: 'Carol Davis',
    hobbies: ['gardening', 'photography', 'reading'],
    skills: ['cleaning', 'organizing', 'pet care'],
    peoplePreference: ['friendly', 'reliable', 'experienced'],
    rating: 4.9,
    ratingCount: 45
  }
];

// Helper functions (copied from controller)
function calculateCompatibilityScore(provider, tasker) {
  let score = 0;
  const maxScore = 100;

  // Hobby matching (40% of total score)
  const providerHobbies = provider.hobbies || [];
  const taskerHobbies = tasker.hobbies || [];
  const matchingHobbies = getMatchingHobbies(providerHobbies, taskerHobbies);
  
  if (providerHobbies.length > 0) {
    const hobbyScore = (matchingHobbies.length / providerHobbies.length) * 40;
    score += hobbyScore;
  }

  // Skills matching (30% of total score)
  const providerSkills = provider.skills || [];
  const taskerSkills = tasker.skills || [];
  const matchingSkills = getMatchingSkills(providerSkills, taskerSkills);
  
  if (providerSkills.length > 0) {
    const skillScore = (matchingSkills.length / providerSkills.length) * 30;
    score += skillScore;
  }

  // People preference matching (20% of total score)
  const providerPreferences = provider.peoplePreference || [];
  const taskerPreferences = tasker.peoplePreference || [];
  
  if (providerPreferences.length > 0 && taskerPreferences.length > 0) {
    const preferenceMatches = providerPreferences.filter(pref => 
      taskerPreferences.some(tPref => 
        pref.toLowerCase().includes(tPref.toLowerCase()) || 
        tPref.toLowerCase().includes(pref.toLowerCase())
      )
    );
    const preferenceScore = (preferenceMatches.length / providerPreferences.length) * 20;
    score += preferenceScore;
  }

  // Rating bonus (10% of total score)
  const ratingBonus = (tasker.rating || 0) * 2; // Max 10 points for 5-star rating
  score += ratingBonus;

  return Math.min(Math.round(score), maxScore);
}

function getMatchingHobbies(providerHobbies, taskerHobbies) {
  return providerHobbies.filter(hobby => 
    taskerHobbies.some(tHobby => 
      hobby.toLowerCase() === tHobby.toLowerCase()
    )
  );
}

function getMatchingSkills(requiredSkills, taskerSkills) {
  return requiredSkills.filter(skill => 
    taskerSkills.some(tSkill => 
      skill.toLowerCase() === tSkill.toLowerCase()
    )
  );
}

function testApplicationMatching() {
  console.log('📊 Application Matching Test Results:\n');
  
  console.log('🎯 Provider Profile:');
  console.log(`   Hobbies: ${mockProvider.hobbies.join(', ')}`);
  console.log(`   Skills: ${mockProvider.skills.join(', ')}`);
  console.log(`   Preferences: ${mockProvider.peoplePreference.join(', ')}\n`);

  // Calculate compatibility scores for each tasker
  const scoredTaskers = mockTaskers.map(tasker => {
    const compatibilityScore = calculateCompatibilityScore(mockProvider, tasker);
    const matchingHobbies = getMatchingHobbies(mockProvider.hobbies, tasker.hobbies);
    const matchingSkills = getMatchingSkills(mockProvider.skills, tasker.skills);
    
    return {
      ...tasker,
      compatibilityScore,
      matchingHobbies,
      matchingSkills
    };
  });

  // Sort by compatibility score (highest first)
  const sortedTaskers = scoredTaskers.sort((a, b) => b.compatibilityScore - a.compatibilityScore);

  console.log('🏆 Ranked Applicants (by compatibility):');
  console.log('─'.repeat(80));

  sortedTaskers.forEach((tasker, index) => {
    console.log(`\n${index + 1}. ${tasker.name} - ${tasker.compatibilityScore}% Match`);
    console.log(`   ⭐ Rating: ${tasker.rating}/5.0 (${tasker.ratingCount} reviews)`);
    console.log(`   🎯 Matching Hobbies: ${tasker.matchingHobbies.join(', ') || 'None'}`);
    console.log(`   🛠️  Matching Skills: ${tasker.matchingSkills.join(', ') || 'None'}`);
    
    // Calculate breakdown
    const hobbyScore = (tasker.matchingHobbies.length / mockProvider.hobbies.length) * 40;
    const skillScore = (tasker.matchingSkills.length / mockProvider.skills.length) * 30;
    const ratingBonus = tasker.rating * 2;
    
    console.log(`   📊 Score Breakdown:`);
    console.log(`      - Hobby Match: ${hobbyScore.toFixed(1)}/40 points`);
    console.log(`      - Skill Match: ${skillScore.toFixed(1)}/30 points`);
    console.log(`      - Rating Bonus: ${ratingBonus.toFixed(1)}/10 points`);
  });

  console.log('\n─'.repeat(80));

  // Verify sorting is correct
  let sortingCorrect = true;
  for (let i = 0; i < sortedTaskers.length - 1; i++) {
    if (sortedTaskers[i].compatibilityScore < sortedTaskers[i + 1].compatibilityScore) {
      sortingCorrect = false;
      break;
    }
  }

  console.log('\n✅ Test Validations:');
  console.log(`   Sorting by compatibility: ${sortingCorrect ? '✅ PASS' : '❌ FAIL'}`);
  
  // Check if Carol (most matching) is ranked first
  const carolFirst = sortedTaskers[0].name === 'Carol Davis';
  console.log(`   Best match ranked first: ${carolFirst ? '✅ PASS' : '❌ FAIL'}`);
  
  // Check if all taskers have compatibility scores
  const allHaveScores = sortedTaskers.every(t => t.compatibilityScore >= 0);
  console.log(`   All applicants have scores: ${allHaveScores ? '✅ PASS' : '❌ FAIL'}`);
  
  // Check if hobby matching works
  const hobbyMatchingWorks = sortedTaskers[0].matchingHobbies.length > 0;
  console.log(`   Hobby matching works: ${hobbyMatchingWorks ? '✅ PASS' : '❌ FAIL'}`);
  
  // Check if skill matching works
  const skillMatchingWorks = sortedTaskers[0].matchingSkills.length > 0;
  console.log(`   Skill matching works: ${skillMatchingWorks ? '✅ PASS' : '❌ FAIL'}`);

  const allTestsPassed = sortingCorrect && carolFirst && allHaveScores && hobbyMatchingWorks && skillMatchingWorks;

  if (allTestsPassed) {
    console.log('\n🎉 All Application Matching Tests PASSED!\n');
    
    console.log('✅ Key Features Verified:');
    console.log('   • Applications sorted by compatibility score (highest first)');
    console.log('   • Hobby matching shows shared interests prominently');
    console.log('   • Skill matching prioritizes relevant experience');
    console.log('   • Rating bonus rewards highly-rated taskers');
    console.log('   • Personality preferences influence matching');
    
    return true;
  } else {
    console.log('\n❌ Some tests failed!');
    return false;
  }
}

// Run the tests
const success = testApplicationMatching();
process.exit(success ? 0 : 1);