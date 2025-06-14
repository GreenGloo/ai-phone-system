// Test the fixed service matching logic for tire rotation
function intelligentServiceMatching(services, requestedService) {
  console.log(`🔍 Testing service matching for: "${requestedService}"`);
  
  if (!requestedService || services.length === 0) {
    return services[0];
  }
  
  const requested = requestedService.toLowerCase();
  
  // Exact match first
  let match = services.find(s => s.name.toLowerCase() === requested);
  if (match) {
    console.log(`✅ EXACT MATCH: ${match.name}`);
    return match;
  }
  
  // Partial match
  match = services.find(s => 
    s.name.toLowerCase().includes(requested) || 
    requested.includes(s.name.toLowerCase())
  );
  if (match) {
    console.log(`✅ PARTIAL MATCH: ${match.name}`);
    return match;
  }
  
  // Updated keyword matching with tire/rotation keywords
  const serviceKeywords = {
    'oil': ['oil', 'lube', 'fluid'],
    'brake': ['brake', 'brakes', 'stopping'],
    'battery': ['battery', 'dead', 'jump', 'start'],
    'diagnostics': ['diagnostic', 'check', 'scan', 'code'],
    'alignment': ['alignment', 'straight', 'pull', 'tire', 'rotation', 'rotate', 'wheel'],
    'transmission': ['transmission', 'shift', 'gear'],
    'air conditioning': ['ac', 'air conditioning', 'cooling', 'heat'],
    'towing': ['tow', 'towing', 'haul', 'emergency'],
    'inspection': ['inspection', 'test', 'safety'],
    'maintenance': ['maintenance', 'service', 'tune']
  };
  
  for (const [category, keywords] of Object.entries(serviceKeywords)) {
    console.log(`  Checking ${category}: ${keywords.join(', ')}`);
    if (keywords.some(keyword => requested.includes(keyword))) {
      console.log(`🔍 Found keyword match in category: ${category}`);
      match = services.find(s => s.name.toLowerCase().includes(category));
      if (match) {
        console.log(`✅ KEYWORD MATCH: ${match.name}`);
        return match;
      } else {
        console.log(`❌ No service found for category: ${category}`);
      }
    }
  }
  
  console.log(`❌ NO MATCH FOUND`);
  return services[0];
}

// Test with the same services from Railway logs
const services = [
  { name: 'Emergency Towing Service' },
  { name: 'Brake Pad Replacement' },
  { name: 'Oil Change & Filter Replacement' },
  { name: 'Engine Diagnostics' },
  { name: 'Wheel Alignment' },
  { name: 'Transmission Fluid Flush' },
  { name: 'Full Vehicle Inspection' },
  { name: 'Battery Replacement' },
  { name: 'Scheduled Maintenance Service' },
  { name: 'Air Conditioning Recharge' }
];

console.log('🧪 TESTING FIXED LOGIC FOR TIRE ROTATION:');
console.log('='.repeat(50));
const result = intelligentServiceMatching(services, 'tire rotation');
console.log(`🎯 FINAL RESULT: ${result.name}`);
console.log('✅ This should now match "Wheel Alignment" instead of falling back to Engine Diagnostics');