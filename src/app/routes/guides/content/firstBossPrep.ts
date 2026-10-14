import { ent, guide, p, route, slots, t, tips, wiki, type Guide } from '../guideModel'

/**
 * Guide 5 — first boss prep (Eye of Cthulhu). The map's own data marks the Eye as the recommended
 * first fight and King Slime as optional (progression.json edges from `pre-hardmode`). Mechanics
 * cite: Eye_of_Cthulhu (natural spawn, despawn at dawn), Suspicious_Looking_Eye + Demon_Altar,
 * Guide:Eye_of_Cthulhu_strategies (arena, gear, potions, phases, weapon suggestions per class,
 * starting just after sunset), Campfire + Heart_Lantern, Treasure_Bag. Drops and summon text are
 * the dataset's.
 */
export const firstBossPrep: Guide = {
  slug: 'first-boss-prep',
  title: 'Preparing for your first boss',
  topic: 'First boss',
  stages: ['early-prehm'],
  summary: 'Getting ready for the Eye of Cthulhu: when it appears, how to summon it, an arena, and a gear check.',
  intro: [
    t`The ${route('bosses', 'boss progression map')} marks the ${ent('boss:eye-of-cthulhu', 'Eye of Cthulhu')} as the recommended first fight, with ${ent('boss:king-slime', 'King Slime')} as an optional alternative. This guide covers the Eye; most of the preparation helps against either.`,
  ],
  sections: [
    {
      id: 'when',
      title: 'When the Eye shows up',
      blocks: [
        p(
          t`The Eye can appear on its own at night once you have enough maximum life and defense and enough town NPCs live in your world — each qualifying night it has a chance to spawn. The ${wiki('Eye_of_Cthulhu', 'Eye of Cthulhu article')} lists the exact conditions.`,
        ),
        p(
          t`You can also call it yourself by using a ${wiki('Suspicious_Looking_Eye', 'Suspicious Looking Eye', 43)} at night. It’s crafted from ${wiki('Lens', 'Lenses', 38)} at a ${wiki('Demon_Altar', 'Demon Altar or Crimson Altar')}, found mainly in and around the chasms of the Corruption or the Crimson. ${ent('enemy:demon-eye', 'Demon Eye', 'Demon Eyes')} drop Lenses.`,
        ),
        p(t`Demon and Crimson Altars can’t be broken before Hardmode, so the altar you craft Suspicious Looking Eyes at stays put.`),
        p(
          t`If the Eye isn’t defeated by dawn, it leaves. The strategy guide suggests starting a night boss just after sunset to give yourself the most time.`,
        ),
        slots(
          'Summoning the Eye',
          wiki('Suspicious_Looking_Eye', 'Suspicious Looking Eye', 43),
          wiki('Lens', 'Lens', 38),
          ent('enemy:demon-eye', 'Demon Eye'),
          ent('boss:eye-of-cthulhu', 'Eye of Cthulhu'),
        ),
      ],
    },
    {
      id: 'arena',
      title: 'Build a simple arena',
      blocks: [
        p(
          t`The wiki’s ${wiki('Guide:Eye_of_Cthulhu_strategies', 'Eye of Cthulhu strategy guide')} recommends an arena about one screen wide. The simplest design is a few rows of ${wiki('Wood_Platform', 'Wood Platforms', 94)}, which give you room to jump and dodge.`,
        ),
        p(
          t`Place a ${wiki('Campfire', 'Campfire', 966)} and a ${wiki('Heart_Lantern', 'Heart Lantern', 1859)} by the arena: each raises your life regeneration while you’re nearby, and the two combine. Platforms are crafted by hand from Wood, a Campfire by hand from Wood and Torches, and a Heart Lantern by hand from a Life Crystal and Chains.`,
        ),
        slots(
          'Arena basics',
          wiki('Wood_Platform', 'Wood Platform', 94),
          wiki('Campfire', 'Campfire', 966),
          wiki('Heart_Lantern', 'Heart Lantern', 1859),
          wiki('Torch', 'Torch', 8),
        ),
      ],
    },
    {
      id: 'gear',
      title: 'Gear check',
      blocks: [
        p(
          t`The strategy guide’s general advice: long-range piercing weapons help, because they hit both the boss and the ${ent('enemy:servant-of-cthulhu', 'Servant of Cthulhu', 'Servants of Cthulhu')} it summons. Gold or Platinum armor gives the most defense of the ore sets, and ${ent('i:54', 'Hermes Boots')} make its charges easier to dodge.`,
        ),
        p(t`Among the weapons it suggests for each class:`),
        slots(
          'Melee',
          ent('i:989', 'Enchanted Sword'),
          ent('i:65', 'Starfury'),
          ent('i:46', "Light's Bane"),
          ent('i:795', 'Blood Butcherer'),
          ent('i:55', 'Enchanted Boomerang'),
        ),
        slots(
          'Ranged',
          ent('i:98', 'Minishark'),
          ent('i:96', 'Musket'),
          ent('i:800', 'The Undertaker'),
          ent('i:3516', 'Gold Bow'),
          ent('i:3480', 'Platinum Bow'),
        ),
        slots('Magic', ent('i:743', 'Ruby Staff'), ent('i:744', 'Diamond Staff'), ent('i:64', 'Vilethorn')),
        slots(
          'Summoner',
          ent('i:5069', 'Flinx Staff'),
          ent('i:4281', 'Finch Staff'),
          ent('i:4672', 'Leather Whip'),
          ent('i:4913', 'Snapthorn'),
        ),
        p(
          t`For potions it suggests ${wiki('Regeneration_Potion', 'Regeneration', 289)}, ${wiki('Ironskin_Potion', 'Ironskin', 292)} and ${wiki('Swiftness_Potion', 'Swiftness', 290)} potions. Bring ${wiki('Lesser_Healing_Potion', 'Lesser Healing Potions', 28)} as well, for when a charge lands.`,
        ),
        slots('Potion buffs', ent('buff:regeneration', 'Regeneration'), ent('buff:ironskin', 'Ironskin'), ent('buff:swiftness', 'Swiftness')),
        tips(
          t`${guide('armor-and-defense', 'Armor and defense')} explains how much each point of defense is worth in your world’s difficulty.`,
        ),
      ],
    },
    {
      id: 'fight',
      title: 'What the fight looks like',
      blocks: [
        p(
          t`In its first phase the Eye floats above you and summons Servants of Cthulhu, then charges at you three times before hovering again. In the second phase it sheds its iris to reveal a fanged mouth: it moves a little faster and hits harder, but has no defense.`,
        ),
        tips(
          t`Keep moving sideways across your platforms during the charges.`,
          t`Clear Servants when they bunch up — a piercing weapon hits several at once.`,
        ),
      ],
    },
    {
      id: 'after',
      title: 'After the fight',
      blocks: [
        p(
          t`Among the Eye’s drops is ore for your world’s evil biome — the ${ent('boss:eye-of-cthulhu', 'Eye of Cthulhu', 'Eye’s full drop list')} is on its page. From there, ${guide('better-equipment', 'Better equipment')} picks up the gear path, and the ${route('bosses', 'boss progression map')} shows what opens up next.`,
        ),
      ],
    },
  ],
  checklist: [
    { id: 'max-life', text: 'Raise your max life with Life Crystals' },
    { id: 'armor', text: 'Wear a full set of ore armor, ideally Gold or Platinum' },
    { id: 'weapon', text: 'Bring a ranged or piercing weapon for the Servants' },
    { id: 'boots', text: 'Equip Hermes Boots or another movement accessory if you have one' },
    { id: 'healing', text: 'Pack Lesser Healing Potions' },
    { id: 'buffs', text: 'Brew Regeneration, Ironskin and Swiftness potions if you can' },
    { id: 'arena', text: 'Build a few rows of platforms about a screen wide' },
    { id: 'regen', text: 'Place a Campfire and a Heart Lantern by the arena' },
    { id: 'summon', text: 'Craft a Suspicious Looking Eye, or wait for the Eye to come' },
    { id: 'early-night', text: 'Start the fight just after sunset' },
  ],
  advanced: {
    title: 'Expert and Master Mode',
    blocks: [
      p(
        t`In Expert and Master Mode the Eye drops a ${wiki('Treasure_Bag', 'Treasure Bag')}. It holds the usual drops plus an Expert-only item, the ${ent('i:3097', 'Shield of Cthulhu')}.`,
      ),
      p(
        t`The Eye has more life and deals more contact damage in those modes; its ${wiki('Eye_of_Cthulhu', 'wiki article')} lists the numbers for each difficulty.`,
      ),
      p(
        t`Defense also counts for more per point there (three quarters of it in Expert, all of it in Master), so armor and the Ironskin buff pull more weight. ${guide('armor-and-defense', 'Armor and defense')} has the math.`,
      ),
    ],
  },
}
