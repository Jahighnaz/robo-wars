// Trophies, PlayStation style: bronze, silver, gold, one platinum, plus hidden
// easter eggs. Checks are pure functions of the save, the profile and (after a
// run) the run result, so they can be tested headless.
import type { RunResult } from '../sim/run';
import type { Save } from '../persistence/save';
import type { Profile } from './profile';
import { B, fam } from '../data';
import { famDmg } from './records';

export type Tier = 'bronze' | 'silver' | 'gold' | 'platinum';

export interface TrophyCtx {
  save: Save;
  p: Profile;
  r?: RunResult;
  challenge?: boolean;
  event?: string;
  now: Date;
}

export interface TrophyDef { id: string; title: string; desc: string; tier: Tier; hidden?: boolean; check: (c: TrophyCtx) => boolean }

const L = (c: TrophyCtx, k: string) => c.p.life[k] || 0;
const run = (c: TrophyCtx) => c.r;
const TOOLS = ['cannon', 'shotgun', 'laser', 'tesla', 'flamer', 'mortar'];

export const TROPHIES: TrophyDef[] = [
  // --- getting started
  { id: 'clocked_in', title: 'Clocked In', desc: 'Finish your first shift.', tier: 'bronze', check: c => !!run(c) },
  { id: 'workplace_incident', title: 'Workplace Incident', desc: 'Get the truck wrecked. Fill in the form in triplicate.', tier: 'bronze', check: c => !!run(c) && !c.r!.won },
  { id: 'meeting_email', title: 'This Meeting Could Have Been an Email', desc: 'Survive until the apex shows up at 5:00.', tier: 'silver', check: c => !!run(c) && c.r!.t >= 300 },
  { id: 'employee_month', title: 'Employee of the Month', desc: 'Destroy an apex.', tier: 'silver', check: c => !!run(c) && c.r!.won },
  { id: 'regional_manager', title: 'Regional Manager', desc: 'Destroy the apex in all three sectors.', tier: 'gold', check: c => L(c, 'win_rust') > 0 && L(c, 'win_tundra') > 0 && L(c, 'win_magma') > 0 },
  { id: 'unpaid_overtime', title: 'Unpaid Overtime', desc: 'Still be on shift at 6:00.', tier: 'silver', check: c => !!run(c) && c.r!.t >= 360 },
  // --- levels
  { id: 'middle_mgmt', title: 'Promoted to Middle Management', desc: 'Reach level 10 in one shift.', tier: 'bronze', check: c => !!run(c) && c.r!.level >= 10 },
  { id: 'c_suite', title: 'C-Suite', desc: 'Reach level 20 in one shift.', tier: 'gold', check: c => !!run(c) && c.r!.level >= 20 },
  // --- tools
  { id: 'nailed_it', title: 'Nailed It', desc: '500 nailgun kills in total.', tier: 'silver', check: c => L(c, 'k_cannon') >= 500 },
  { id: 'saw_coming', title: 'Saw That Coming', desc: '200 saw launcher kills in total.', tier: 'bronze', check: c => L(c, 'k_shotgun') >= 200 },
  { id: 'measure_twice', title: 'Measure Twice, Cut Once', desc: '100 laser cutter kills in total.', tier: 'bronze', check: c => L(c, 'k_laser') >= 100 },
  { id: 'reply_all', title: 'Reply All', desc: 'One arc welder discharge hits 5 enemies.', tier: 'silver', check: c => !!run(c) && c.r!.stats.maxChain >= 5 },
  { id: 'sticky_situation', title: 'Sticky Situation', desc: '50 hot glue kills in one shift.', tier: 'bronze', check: c => !!run(c) && Object.keys(c.r!.ks).reduce((a, k) => a + (fam(k) === 'flamer' ? c.r!.ks[k] : 0), 0) >= 50 },
  { id: 'plasma_screensaver', title: 'Plasma Screensaver', desc: '100 plasma cutter kills in total.', tier: 'bronze', check: c => L(c, 'k_mortar') >= 100 },
  { id: 'full_toolbox', title: 'Full Toolbox', desc: 'Deal damage with all six tools in one shift.', tier: 'gold', check: c => !!run(c) && TOOLS.every(t => famDmg(c.r!, t) > 0) },
  { id: 'percussive', title: 'Percussive Maintenance', desc: 'Land a single hit of 150 or more.', tier: 'bronze', check: c => !!run(c) && c.r!.stats.maxHit >= 150 },
  // --- driving and surviving
  { id: 'donuts', title: 'Doing Donuts in the Parking Lot', desc: 'Spin 25 full turns in one shift.', tier: 'bronze', check: c => !!run(c) && c.r!.stats.spins >= 25 },
  { id: 'long_commute', title: 'Long Commute', desc: 'Drive 2 km in one shift.', tier: 'bronze', check: c => !!run(c) && c.r!.stats.dist / 18 >= 2000 },
  { id: 'some_assembly', title: 'Some Assembly Required', desc: 'Lose 6 blocks in one shift.', tier: 'bronze', check: c => !!run(c) && c.r!.stats.blocksLost >= 6 },
  { id: 'held_by_hope', title: 'Held Together with Hope and Zip Ties', desc: 'Destroy the apex after the cab dropped below 15%.', tier: 'gold', check: c => !!run(c) && c.r!.won && c.r!.stats.minCab < 0.15 },
  { id: 'hse', title: 'Health & Safety Officer', desc: 'Take less than 40 damage in the first two minutes.', tier: 'silver', check: c => !!run(c) && c.r!.stats.takenAt120 >= 0 && c.r!.stats.takenAt120 < 40 },
  { id: 'inventory_day', title: 'Inventory Day', desc: 'Salvage 8 supply crystals in one shift.', tier: 'bronze', check: c => !!run(c) && c.r!.stats.mined + c.r!.stats.caches >= 8 },
  { id: 'stuck_traffic', title: 'Stuck in Traffic', desc: 'Spend 30 s in the Junkyard oil sludge in one shift.', tier: 'bronze', check: c => !!run(c) && c.r!.wk === 'rust' && c.r!.stats.hazardT >= 30 },
  { id: 'slippery', title: 'Caution: Wet Floor', desc: 'Spend 30 s on the Cold Storage ice in one shift.', tier: 'bronze', check: c => !!run(c) && c.r!.wk === 'tundra' && c.r!.stats.hazardT >= 30 },
  { id: 'hot_desking', title: 'Hot Desking', desc: 'Spend 30 s in Foundry slag in one shift.', tier: 'bronze', check: c => !!run(c) && c.r!.wk === 'magma' && c.r!.stats.hazardT >= 30 },
  // --- the long game
  { id: 'pest_control', title: 'Pest Control Contractor', desc: '1,000 kills in total.', tier: 'silver', check: c => L(c, 'kills') >= 1000 },
  { id: 'exterminator', title: 'Exterminator of the Year', desc: '10,000 kills in total.', tier: 'gold', check: c => L(c, 'kills') >= 10000 },
  { id: 'supply_closet', title: 'Supply Closet Hoarder', desc: 'Bank 1,000 parts in total.', tier: 'silver', check: c => L(c, 'loot') >= 1000 },
  { id: 'expense_account', title: 'Expense Account', desc: 'Hold 1,000 scrap metal at once.', tier: 'silver', check: c => (c.save.res.scrap || 0) >= 1000 },
  { id: 'corner_office', title: 'Corner Office', desc: 'Expand the build grid to 9×9.', tier: 'gold', check: c => c.save.gridR >= 4 },
  { id: 'over_engineered', title: 'Over-Engineered', desc: 'Upgrade any block to Mk VI.', tier: 'gold', check: c => Object.values(c.save.up).some(v => v >= 5) },
  { id: 'legacy_code', title: 'Legacy Code', desc: 'Push any sector into its second era.', tier: 'silver', check: c => Object.values(c.save.worlds).some(w => w.era >= 2) },
  { id: 'duct_tape', title: "If It Moves and Shouldn't", desc: 'Fabricate duct tape.', tier: 'bronze', check: c => c.event === 'craft:regen' },
  { id: 'circle_back', title: "Let's Circle Back on That", desc: 'Reroll your level-up cards.', tier: 'bronze', check: c => c.event === 'reroll' },
  // --- defence, tiers, co-op
  { id: 'not_today', title: 'Not Today, Thank You', desc: 'Zap 50 enemy projectiles in one shift.', tier: 'silver', check: c => !!run(c) && (c.r!.stats.zapped || 0) >= 50 },
  { id: 'firewall', title: 'Human Firewall', desc: 'Zap 1,000 enemy projectiles in total.', tier: 'gold', check: c => L(c, 'zapped') >= 1000 },
  { id: 'upgrade_path', title: 'Career Development Plan', desc: 'Fabricate your first tier II block.', tier: 'bronze', check: c => c.event?.startsWith('craft:') === true && B[c.event.slice(6)]?.tier === 2 },
  { id: 'senior_partner', title: 'Senior Partner', desc: 'Fabricate a tier III block.', tier: 'silver', check: c => c.event?.startsWith('craft:') === true && B[c.event.slice(6)]?.tier === 3 },
  { id: 'big_rig', title: 'Corner Office on Wheels', desc: 'Upgrade the cab to the big rig.', tier: 'gold', check: c => c.save.build.some(b => b.t === 'cab3') },
  { id: 'mk_ten', title: 'Over-Over-Engineered', desc: 'Take any block to Mk X.', tier: 'gold', check: c => Object.values(c.save.up).some(v => v >= 9) },
  { id: 'teamwork', title: 'Teamwork Makes the Dream Work', desc: 'Finish a co-op shift.', tier: 'bronze', check: c => !!run(c) && (c.r!.crew || 1) > 1 },
  { id: 'carpool', title: 'Carpool Lane', desc: 'Destroy the apex in a co-op shift.', tier: 'silver', check: c => !!run(c) && (c.r!.crew || 1) > 1 && c.r!.won },
  { id: 'intern_driving', title: 'Who Let the Intern Drive?', desc: 'Get wrecked three times in one co-op shift.', tier: 'bronze', hidden: true, check: c => !!run(c) && (c.r!.stats.downs || 0) >= 3 },
  // --- crew
  { id: 'team_building', title: 'Team Building Exercise', desc: 'Host or join a crew.', tier: 'bronze', check: c => c.event === 'crew' },
  { id: 'office_politics', title: 'Office Politics', desc: "Beat a crew-mate's score in a challenge.", tier: 'silver', check: c => c.event === 'beat_mate' },
  { id: 'the_procrastinator', title: 'The Procrastinator', desc: 'Spend 30 s of one shift not touching the controls.', tier: 'bronze', check: c => !!run(c) && c.r!.stats.idleT >= 30 },
  // --- platinum
  { id: 'charles_proud', title: 'Charles Would Be Proud', desc: 'Unlock every other trophy (easter eggs not required).', tier: 'platinum', check: c => TROPHIES.every(t => t.hidden || t.tier === 'platinum' || !!c.p.trophies[t.id]) },
  // --- hidden easter eggs
  { id: 'bobblehead_fan', title: 'Bobblehead Fan Club', desc: 'Pester Captain Charles ten times on the menu.', tier: 'bronze', hidden: true, check: c => c.event === 'tap_charles' && (c.p.eggs.tap_charles || 0) >= 10 },
  { id: 'identity_theft', title: 'Identity Theft', desc: 'Call yourself Charles. There can only be one.', tier: 'bronze', hidden: true, check: c => c.event === 'rename' && c.p.name.trim().toLowerCase() === 'charles' },
  { id: 'secret_handshake', title: 'Secret Handshake', desc: 'Tap the // in the title seven times.', tier: 'bronze', hidden: true, check: c => c.event === 'slash' && (c.p.eggs.slash || 0) >= 7 },
  { id: 'midnight_oil', title: 'Burning the Midnight Oil', desc: 'Finish a shift between midnight and 4 am.', tier: 'silver', hidden: true, check: c => !!run(c) && c.now.getHours() < 4 },
  { id: 'mondays', title: 'A Case of the Mondays', desc: 'Get wrecked on a Monday.', tier: 'bronze', hidden: true, check: c => !!run(c) && !c.r!.won && c.now.getDay() === 1 },
  { id: 'friday', title: 'Friday Afternoon Energy', desc: 'Finish a shift on a Friday after 3 pm.', tier: 'bronze', hidden: true, check: c => !!run(c) && c.now.getDay() === 5 && c.now.getHours() >= 15 },
  { id: 'quiet_quitting', title: 'Quiet Quitting', desc: 'Survive a whole minute without touching the controls.', tier: 'silver', hidden: true, check: c => !!run(c) && (c.r!.stats.touched ? c.r!.stats.firstTouchT >= 60 : c.r!.t >= 60) },
  { id: 'speedrun_hr', title: 'Speedrun to HR', desc: 'Get wrecked within 45 seconds.', tier: 'bronze', hidden: true, check: c => !!run(c) && !c.r!.won && c.r!.t < 45 },
  { id: 'rage_quit', title: 'Rage Quit', desc: 'Abandon a shift from the pause menu.', tier: 'bronze', hidden: true, check: c => c.event === 'abandon' },
  { id: 'coffee_break', title: 'Coffee Break', desc: 'Leave a shift paused for two minutes.', tier: 'bronze', hidden: true, check: c => c.event === 'long_pause' },
  { id: 'ctrl_z', title: 'Ctrl+Z', desc: 'Strip the truck down to just the cab.', tier: 'bronze', hidden: true, check: c => c.event === 'garage' && c.save.build.length === 1 },
  { id: 'synergy', title: 'Synergy!', desc: 'Put a nailgun between three other nailguns. Leverage those core competencies.', tier: 'silver', hidden: true,
    check: c => c.event === 'garage' && c.save.build.some(b => b.t === 'cannon' && c.save.build.filter(o => o.t === 'cannon' && Math.abs(o.x - b.x) + Math.abs(o.y - b.y) === 1).length >= 3) },
];

export const TIER_ORDER: Tier[] = ['platinum', 'gold', 'silver', 'bronze'];

/** Unlocks every trophy whose check passes; returns the newly unlocked ones. */
export function evaluate(c: TrophyCtx): TrophyDef[] {
  const out: TrophyDef[] = [];
  // two passes so the platinum can unlock in the same evaluation as the last trophy
  for (let pass = 0; pass < 2; pass++) {
    for (const t of TROPHIES) {
      if (c.p.trophies[t.id]) continue;
      let ok = false;
      try { ok = t.check(c); } catch { ok = false; }
      if (ok) { c.p.trophies[t.id] = c.now.getTime(); out.push(t); }
    }
  }
  return out;
}

export const trophyById = (id: string) => TROPHIES.find(t => t.id === id);
