import { ent, guide, p, route, slots, t, tips, wiki, type Guide } from '../guideModel'

/**
 * Guide 3 — the pre-Hardmode gear ladder. Every weapon/armor claim links a record whose page (or
 * wiki article) shows the recipe or source; recipes, drop sources and shop entries are the
 * dataset's. Mechanics cite: Ores (ore pairs, evil ore by world), Pickaxe_power + Platinum_Pickaxe,
 * Demonite_Ore / Crimtane_Ore (where the evil ores come from), Shadow_Orb (first orb's Musket),
 * Arms_Dealer (move-in rule and shop), Meteorite, Dungeon, Hellforge.
 */
export const betterEquipment: Guide = {
  slug: 'better-equipment',
  title: 'Better equipment: the pre-Hardmode gear path',
  topic: 'Equipment',
  stages: ['early-prehm', 'late-prehm'],
  summary: 'From wood to the ore tiers to boss materials — what to craft next and where it comes from.',
  intro: [
    t`Gear before Hardmode climbs a fairly clear ladder: wood, then the metal ore tiers, then your world’s evil ore and the materials bosses drop. Every weapon below links to its page, where you can compare damage and speed and see the exact recipe.`,
    t`This guide follows melee, ranged and magic weapons up the ore tiers and notes summoner options where they appear. Play whichever class you enjoy — none of these steps locks you in.`,
  ],
  sections: [
    {
      id: 'wood',
      title: 'Start with wood',
      blocks: [
        p(
          t`A ${wiki('Work_Bench', 'Work Bench', 36)} and a pile of Wood give you the ${ent('i:24', 'Wooden Sword')}, the ${ent('i:39', 'Wooden Bow')} with ${ent('i:40', 'Wooden Arrow', 'Wooden Arrows')}, and ${ent('set:wood-armor', 'Wood armor')}. They’re modest, but they cost nothing except time.`,
        ),
        slots('Wooden gear', ent('i:24', 'Wooden Sword'), ent('i:39', 'Wooden Bow'), ent('i:40', 'Wooden Arrow'), ent('set:wood-armor', 'Wood armor')),
      ],
    },
    {
      id: 'ore-tiers',
      title: 'Climb the ore tiers',
      blocks: [
        p(
          t`Smelt ore into bars at a ${wiki('Furnace', 'Furnace', 33)}, then craft at an ${wiki('Iron_Anvil', 'Iron Anvil', 35)} or ${wiki('Lead_Anvil', 'Lead Anvil', 716)}. The pre-Hardmode ore tiers run Copper or Tin, then Iron or Lead, Silver or Tungsten, and Gold or Platinum — a world generally has one ore from each pair (${wiki('Ores', 'Ores')}).`,
        ),
        p(
          t`Every tier makes a broadsword, a bow, a pickaxe and a full armor set. For magic, gem staves pair a gem with a bar: the ${ent('i:739', 'Amethyst Staff')} uses Copper Bars, while the ${ent('i:744', 'Diamond Staff')} uses Platinum Bars.`,
        ),
        slots(
          'Broadswords, tier by tier',
          ent('i:3508', 'Copper Broadsword'),
          ent('i:3502', 'Tin Broadsword'),
          ent('i:4', 'Iron Broadsword'),
          ent('i:3496', 'Lead Broadsword'),
          ent('i:3514', 'Silver Broadsword'),
          ent('i:3490', 'Tungsten Broadsword'),
          ent('i:3520', 'Gold Broadsword'),
          ent('i:3484', 'Platinum Broadsword'),
        ),
        slots(
          'Bows, tier by tier',
          ent('i:3504', 'Copper Bow'),
          ent('i:3498', 'Tin Bow'),
          ent('i:99', 'Iron Bow'),
          ent('i:3492', 'Lead Bow'),
          ent('i:3510', 'Silver Bow'),
          ent('i:3486', 'Tungsten Bow'),
          ent('i:3516', 'Gold Bow'),
          ent('i:3480', 'Platinum Bow'),
        ),
        slots(
          'Gem staves',
          ent('i:739', 'Amethyst Staff'),
          ent('i:740', 'Topaz Staff'),
          ent('i:741', 'Sapphire Staff'),
          ent('i:742', 'Emerald Staff'),
          ent('i:743', 'Ruby Staff'),
          ent('i:744', 'Diamond Staff'),
        ),
        tips(
          t`Torn between two weapons? Try both in the ${route('lab', 'Weapon Lab')} before you spend the bars — it’s a browser simulation, so treat its numbers as a comparison, not an exact match for the game.`,
          t`Summoners have early options too: the ${ent('i:5069', 'Flinx Staff')} is made from Flinx Fur and Gold or Platinum Bars, and the ${ent('i:4281', 'Finch Staff')} is found in Living Wood chests.`,
        ),
      ],
    },
    {
      id: 'pickaxe',
      title: 'Upgrade your pickaxe',
      blocks: [
        p(
          t`Harder ores need more ${wiki('Pickaxe_power', 'pickaxe power')}. A ${wiki('Gold_Pickaxe', 'Gold Pickaxe', 3521)} or ${wiki('Platinum_Pickaxe', 'Platinum Pickaxe', 3485)} is strong enough for Demonite and Crimtane ore, the next rung of the ladder.`,
        ),
      ],
    },
    {
      id: 'evil-ore',
      title: 'Your world’s evil ore',
      blocks: [
        p(
          t`A Corruption world has ${wiki('Demonite_Ore', 'Demonite Ore', 56)} and a Crimson world has ${wiki('Crimtane_Ore', 'Crimtane Ore', 880)}. Most of it comes from bosses: the ${ent('boss:eye-of-cthulhu', 'Eye of Cthulhu')} drops your world’s kind, and so do the ${ent('boss:eater-of-worlds', 'Eater of Worlds')} and the ${ent('boss:brain-of-cthulhu', 'Brain of Cthulhu')}. Small veins also turn up underground.`,
        ),
        p(
          t`The bars make the ${ent('i:46', "Light's Bane")} or ${ent('i:795', 'Blood Butcherer')} and the ${ent('i:44', 'Demon Bow')} or ${ent('i:796', 'Tendon Bow')}. Add ${wiki('Shadow_Scale', 'Shadow Scales', 86)} from the Eater of Worlds, or ${wiki('Tissue_Sample', 'Tissue Samples', 1329)} from the Brain of Cthulhu, for ${ent('set:shadow-armor', 'Shadow armor')} or ${ent('set:crimson-armor', 'Crimson armor')} and the ${wiki('Nightmare_Pickaxe', 'Nightmare Pickaxe', 103)} or ${wiki('Deathbringer_Pickaxe', 'Deathbringer Pickaxe', 798)}.`,
        ),
        slots(
          'Evil-ore gear',
          ent('i:46', "Light's Bane"),
          ent('i:795', 'Blood Butcherer'),
          ent('i:44', 'Demon Bow'),
          ent('i:796', 'Tendon Bow'),
          ent('set:shadow-armor', 'Shadow armor'),
          ent('set:crimson-armor', 'Crimson armor'),
        ),
      ],
    },
    {
      id: 'found-bought',
      title: 'Found, bought and dropped',
      blocks: [
        p(
          t`Not everything is crafted. Breaking your first ${wiki('Shadow_Orb', 'Shadow Orb')} in the Corruption with a hammer or explosives always gives a ${ent('i:96', 'Musket')}; breaking your first ${wiki('Crimson_Heart', 'Crimson Heart')} in the Crimson the same way always gives ${ent('i:800', 'The Undertaker')}.`,
        ),
        p(
          t`The ${wiki('Arms_Dealer', 'Arms Dealer')} moves in once you carry a gun or bullets, and sells the ${ent('i:95', 'Flintlock Pistol')}, the ${ent('i:98', 'Minishark')} and ${ent('i:97', 'Musket Ball', 'Musket Balls')}. Chests hold weapons too — the ${ent('i:3069', 'Wand of Sparking')} is one example.`,
        ),
        slots(
          'Found and bought',
          ent('i:96', 'Musket'),
          ent('i:800', 'The Undertaker'),
          ent('i:95', 'Flintlock Pistol'),
          ent('i:98', 'Minishark'),
          ent('i:97', 'Musket Ball'),
          ent('i:3069', 'Wand of Sparking'),
        ),
      ],
    },
    {
      id: 'boss-gear',
      title: 'Gear from bosses',
      blocks: [
        p(
          t`Early bosses add their own gear: ${ent('boss:king-slime', 'King Slime')} drops the pieces of ${ent('set:ninja-armor', 'Ninja armor')}, and ${ent('boss:queen-bee', 'Queen Bee')} can drop the ${ent('i:1123', 'Bee Keeper')} or the ${ent('i:1121', 'Bee Gun')}, among other things. The ${route('bosses', 'boss progression map')} shows how the bosses unlock each other.`,
        ),
        slots('Boss gear', ent('set:ninja-armor', 'Ninja armor'), ent('i:1123', 'Bee Keeper'), ent('i:1121', 'Bee Gun')),
        tips(t`Before a boss, read ${guide('first-boss-prep', 'Preparing for your first boss')} and ${guide('armor-and-defense', 'Armor and defense')}.`),
      ],
    },
  ],
  checklist: [
    { id: 'wood-gear', text: 'Craft a wooden weapon and some Wood armor' },
    { id: 'furnace-anvil', text: 'Build a Furnace and an Iron or Lead Anvil' },
    { id: 'first-ore-weapon', text: 'Craft a weapon from your first metal bars' },
    { id: 'full-ore-set', text: 'Wear a full matching set of ore armor' },
    { id: 'pickaxe', text: 'Upgrade to a Gold or Platinum Pickaxe' },
    { id: 'top-ore', text: 'Reach Gold or Platinum weapons' },
    { id: 'evil-ore', text: 'Collect Demonite or Crimtane ore' },
    { id: 'evil-weapon', text: 'Craft a weapon from your world’s evil ore' },
    { id: 'arms-dealer', text: 'Get the Arms Dealer to move in' },
  ],
  advanced: {
    title: 'Further up: meteorite, the Jungle and Night’s Edge',
    blocks: [
      p(
        t`A ${wiki('Meteorite', 'meteorite')} crash site appears after you first defeat the Eater of Worlds or the Brain of Cthulhu. Its bars make the ${ent('i:127', 'Space Gun')} and ${ent('set:meteor-armor', 'Meteor armor')}. Touching Meteorite burns you unless you wear an ${ent('i:193', 'Obsidian Skull')} or drink an Obsidian Skin Potion.`,
      ),
      p(
        t`${ent('i:273', "Night's Edge")} combines four swords at a Demon or Crimson Altar: ${ent('i:46', "Light's Bane")} or ${ent('i:795', 'Blood Butcherer')}, ${ent('i:155', 'Muramasa')}, ${ent('i:190', 'Blade of Grass')} and ${ent('i:121', 'Volcano')}.`,
      ),
      p(
        t`Muramasa comes from gold chests in the ${wiki('Dungeon', 'Dungeon')}, which is only safe to explore after ${ent('boss:skeletron', 'Skeletron')}. Blade of Grass is made from Jungle materials. Volcano needs ${wiki('Hellstone', 'Hellstone', 174)} bars: Hellstone takes a Nightmare or Deathbringer Pickaxe to mine and a ${wiki('Hellforge', 'Hellforge', 221)} — found in the Underworld — to smelt. The same bars make ${ent('set:molten-armor', 'Molten armor')}.`,
      ),
      slots(
        'Toward Night’s Edge',
        ent('i:273', "Night's Edge"),
        ent('i:155', 'Muramasa'),
        ent('i:190', 'Blade of Grass'),
        ent('i:121', 'Volcano'),
        ent('i:127', 'Space Gun'),
        ent('set:meteor-armor', 'Meteor armor'),
        ent('set:molten-armor', 'Molten armor'),
      ),
    ],
  },
}
