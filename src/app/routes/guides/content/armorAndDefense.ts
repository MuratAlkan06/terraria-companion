import { ent, guide, list, p, slots, t, tips, wiki, type Guide } from '../guideModel'

/**
 * Guide 4 — armor and defense. Mechanics cite: Defense (per-difficulty reduction, minimum 1 damage,
 * the defense counter's tooltip), Armor (slots, mixing pieces, set bonuses), Guide:Eye_of_Cthulhu_strategies
 * (Gold/Platinum as the strongest ore armor), Treasure_Bag (Expert/Master only), Ironskin_Potion,
 * Regeneration_Potion. Set bonuses, accessory effects and sources are the dataset's.
 */
export const armorAndDefense: Guide = {
  slug: 'armor-and-defense',
  title: 'Armor and defense',
  topic: 'Armor & defense',
  stages: ['early-prehm', 'late-prehm'],
  summary: 'How defense reduces damage, why full sets matter, and the accessories and potions that add protection.',
  intro: [
    t`Defense takes a fixed amount off every hit you take. It comes from armor, set bonuses, accessories and potions, and knowing how it works helps you decide what to craft next.`,
  ],
  sections: [
    {
      id: 'what-defense-does',
      title: 'What defense does',
      blocks: [
        p(
          t`Each point of ${wiki('Defense', 'defense')} reduces the damage of every hit. How much depends on the world’s difficulty: in Classic, half your defense is subtracted from each hit; in Expert, three quarters; in Master, all of it. A hit always deals at least 1 damage.`,
        ),
        p(t`The defense counter in your inventory has a tooltip that shows how much damage your defense blocks.`),
      ],
    },
    {
      id: 'sets',
      title: 'Pieces and set bonuses',
      blocks: [
        p(
          t`${wiki('Armor', 'Armor')} goes in three slots: head, body and legs. Each piece adds its own defense, and wearing all three pieces of the same set adds a set bonus. You can mix pieces from different sets — you keep each piece’s defense but lose the bonus.`,
        ),
        p(
          t`For the ore sets, the bonus is a little extra defense — compare ${ent('set:copper-armor', 'Copper armor')} with ${ent('set:platinum-armor', 'Platinum armor')}. Other sets trade that for an effect: ${ent('set:mining-armor', 'Mining armor')} speeds up mining, ${ent('set:ninja-armor', 'Ninja armor')} increases movement speed, ${ent('set:fossil-armor', 'Fossil armor')} can save ammo and ${ent('set:jungle-armor', 'Jungle armor')} reduces mana costs.`,
        ),
        slots(
          'Early armor sets',
          ent('set:copper-armor', 'Copper armor'),
          ent('set:iron-armor', 'Iron armor'),
          ent('set:gold-armor', 'Gold armor'),
          ent('set:platinum-armor', 'Platinum armor'),
          ent('set:mining-armor', 'Mining armor'),
          ent('set:ninja-armor', 'Ninja armor'),
          ent('set:fossil-armor', 'Fossil armor'),
          ent('set:jungle-armor', 'Jungle armor'),
        ),
        tips(
          t`Mixing pieces is fine while you save bars for a full set — you only give up the set bonus.`,
          t`After each upgrade, hover the defense counter in your inventory to see how much it blocks now.`,
        ),
      ],
    },
    {
      id: 'which-set',
      title: 'Which armor to aim for early',
      blocks: [
        p(
          t`Among the ore sets, ${ent('set:gold-armor', 'Gold armor')} and ${ent('set:platinum-armor', 'Platinum armor')} give the most defense; the wiki’s ${wiki('Guide:Eye_of_Cthulhu_strategies', 'Eye of Cthulhu strategy guide')} points to them for the first boss. A world generally has only one of the two ores.`,
        ),
        p(
          t`Armor is bar-hungry, and in every ore set the body piece costs the most bars, so plan your smelting before you start. Later, your world’s evil ore leads to ${ent('set:shadow-armor', 'Shadow armor')} or ${ent('set:crimson-armor', 'Crimson armor')} — see ${guide('better-equipment', 'Better equipment')}.`,
        ),
      ],
    },
    {
      id: 'accessories',
      title: 'Accessories that protect you',
      blocks: [
        p(t`A few early accessories add defense or keep you out of trouble:`),
        list(
          t`${ent('i:216', 'Shackle')} — 1 defense; zombies drop it.`,
          t`${ent('i:193', 'Obsidian Skull')} — 1 defense and immunity to fire blocks; crafted from Obsidian at a Furnace.`,
          t`${ent('i:49', 'Band of Regeneration')} — slowly regenerates life; found in Gold Chests.`,
          t`${ent('i:158', 'Lucky Horseshoe')} — negates fall damage.`,
          t`${ent('i:156', 'Cobalt Shield')} — 1 defense and immunity to knockback; it comes from Dungeon gold chests, so it arrives after Skeletron.`,
        ),
        slots(
          'Protective accessories',
          ent('i:216', 'Shackle'),
          ent('i:193', 'Obsidian Skull'),
          ent('i:49', 'Band of Regeneration'),
          ent('i:158', 'Lucky Horseshoe'),
          ent('i:156', 'Cobalt Shield'),
        ),
        p(
          t`In Expert and Master Mode, bosses drop a ${wiki('Treasure_Bag', 'Treasure Bag')} with an extra item. The Eater of Worlds’ bag holds the ${ent('i:3224', 'Worm Scarf')}, which reduces damage taken, and the Brain of Cthulhu’s holds the ${ent('i:3223', 'Brain of Confusion')}, which can dodge attacks.`,
        ),
      ],
    },
    {
      id: 'buffs',
      title: 'Potions and buffs',
      blocks: [
        p(
          t`An ${wiki('Ironskin_Potion', 'Ironskin Potion', 292)} grants the ${ent('buff:ironskin', 'Ironskin')} buff, which raises your defense for several minutes. It’s brewed from Bottled Water, a Daybloom and Iron or Lead ore at a placed Bottle.`,
        ),
        p(
          t`The ${wiki('Regeneration_Potion', 'Regeneration Potion', 289)} grants ${ent('buff:regeneration', 'Regeneration')}, which restores health over time. It isn’t defense, but the two work well together: defense shrinks each hit, regeneration refills the gap.`,
        ),
        slots('Protective potions', wiki('Ironskin_Potion', 'Ironskin Potion', 292), wiki('Regeneration_Potion', 'Regeneration Potion', 289)),
      ],
    },
  ],
  checklist: [
    { id: 'check-defense', text: 'Hover the defense counter in your inventory' },
    { id: 'full-set', text: 'Wear a full matching armor set for its bonus' },
    { id: 'top-ore-armor', text: 'Craft Gold or Platinum armor, whichever your world has' },
    { id: 'defense-accessory', text: 'Equip a Shackle or an Obsidian Skull' },
    { id: 'regen-accessory', text: 'Equip a Band of Regeneration if you find one' },
    { id: 'ironskin', text: 'Brew a few Ironskin Potions for tough fights' },
    { id: 'life', text: 'Keep raising your max life with Life Crystals' },
  ],
  advanced: {
    title: 'The defense math',
    blocks: [
      p(
        t`${wiki('Defense', 'Defense')} is subtracted from each hit: half of it in Classic, three quarters in Expert, all of it in Master, with a floor of 1 damage. So 20 defense removes 10 damage from every hit in Classic, 15 in Expert and 20 in Master.`,
      ),
      p(
        t`Because it removes a fixed amount per hit, defense matters most against many small hits and less against a few huge ones. For the same reason the Ironskin buff is worth more in harder modes: the same defense removes more from each hit.`,
      ),
      p(
        t`Some effects reduce damage by a percentage instead — the ${ent('i:3224', 'Worm Scarf')} and the ${ent('buff:endurance', 'Endurance')} buff, for example. That’s a separate mechanic from defense.`,
      ),
    ],
  },
}
