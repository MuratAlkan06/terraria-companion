/* Drop-list group captions (P5-S3, AMENDMENTS-015 B82): the rendered drop list of a boss article,
 * reduced to the markup the parser reads (shapes copied from the cached Eye of Cthulhu and Plantera
 * revisions). */
import { describe, expect, it } from 'vitest'
import { conditionMatchers, loadConditionsOverlay } from '../merge/overlays'
import { captionConditions, captionText, parseDropListing } from './dropCaptions'

const item = (name: string, cls: string) => `<li class="${cls}"><div><span class="i"><a href="/wiki/${name.replaceAll(' ', '_')}" title="${name}"><img alt="${name}"/></a><span><span><a href="/wiki/${name.replaceAll(' ', '_')}" title="${name}">${name}</a></span></span></span></div><div>100%</div></li>`
const caption = (text: string, cls = 'groupstart caption') => `<li class="${cls}">${text} <sup id="cite_ref-drops_4-0" class="reference"><a href="#cite_note-drops-4"><span class="cite-bracket">&#91;</span>4<span class="cite-bracket">&#93;</span></a></sup></li>`

/** Eye of Cthulhu: Unholy Arrow outside the groups; the world-evil ores and seeds inside; the bag repeats them. */
const EYE = `<div class="section drops"><ul class="drops items"><li><strong>Item <small>(Quantity)</small></strong><strong>Rate</strong></li>
${item('Unholy Arrow', 'm-normal')}
${caption('Only in Corrupt worlds')}${item('Demonite Ore', 'm-normal group')}${item('Corrupt Seeds', 'm-normal group')}<li class="groupend"></li>
${caption('Only in Crimson worlds')}${item('Crimtane Ore', 'm-normal group')}${item('Crimson Seeds', 'm-normal group')}<li class="groupend"></li>
${item('Lesser Healing Potion', '')}
${item('Treasure Bag (Eye of Cthulhu)', 'm-expert-master')}<li class="lootstart m-expert-master"></li>
${item('Unholy Arrow', 'm-expert-master loot')}
${caption('Only in Corrupt worlds', 'groupstart caption m-expert-master loot')}${item('Demonite Ore', 'm-expert-master group loot')}<li class="groupend"></li>
${caption('Only in Crimson worlds', 'groupstart caption m-expert-master loot')}${item('Crimtane Ore', 'm-expert-master group loot')}<li class="groupend"></li>
</ul></div>`

/** Plantera (a Hardmode case): a selection group (no condition) and the "when … not present" group, whose caption links its section. */
const PLANTERA = `<ul class="drops items">${item('Temple Key', '')}
${caption('One of the following 8 items will always be dropped&#160;')}${item('Venus Magnum', 'group')}${item('Seedler', 'group')}<li class="groupend"></li>
<li class="groupstart caption">When <a class="mw-selflink-fragment" href="#Jungle_Temple_drops">the Jungle Temple is not present</a></li>${item('Lihzahrd Brick', 'group')}${item('Forbidden Lihzahrd Brick Wall', 'group')}${item('Lihzahrd Altar', 'group')}${item('Picksaw', 'group')}<li class="groupend"></li></ul>`

const WORLD: Record<string, string> = { 'Only in Corrupt worlds': 'corruption-world', 'Only in Crimson worlds': 'crimson-world' }
const conditionFor = (c: string) => WORLD[c]
/** The shipped registry's captions (pipeline/overlays/conditions.json match.dropCaptions). */
const REGISTERED: Record<string, string> = { ...WORLD, 'When the Jungle Temple is not present': 'jungle-temple-absent' }

describe('parseDropListing', () => {
  it('records each listing of an item with its group caption (null outside any group); captions lose their footnote marker', () => {
    const { byItem } = parseDropListing(EYE)
    expect(byItem.get('Unholy Arrow')).toEqual([null, null])
    expect(byItem.get('Demonite Ore')).toEqual(['Only in Corrupt worlds', 'Only in Corrupt worlds'])
    expect(byItem.get('Crimson Seeds')).toEqual(['Only in Crimson worlds'])
    expect(byItem.get('Lesser Healing Potion')).toEqual([null])
    expect(captionText('Only in Corrupt worlds <sup class="reference">[4]</sup>')).toBe('Only in Corrupt worlds')
  })

  it('ignores markup outside the drop lists', () => {
    expect(parseDropListing(`<ul><li><a href="/wiki/Demonite_Ore" title="Demonite Ore">x</a></li></ul>`).byItem.size).toBe(0)
  })
})

describe('captionConditions', () => {
  it('Eye of Cthulhu: the world-evil ores and seeds get their world, the Unholy Arrow (listed outside the groups) nothing', () => {
    const out = captionConditions(parseDropListing(EYE), conditionFor)
    expect(Object.fromEntries(out)).toEqual({
      'Demonite Ore': { conditions: ['corruption-world'] },
      'Corrupt Seeds': { conditions: ['corruption-world'] },
      'Crimtane Ore': { conditions: ['crimson-world'] },
      'Crimson Seeds': { conditions: ['crimson-world'] },
    })
  })

  it('Plantera (Hardmode): the four Jungle Temple items get the "not present" condition (caption read through its section link); the selection group adds nothing', () => {
    expect(parseDropListing(PLANTERA).byItem.get('Picksaw')).toEqual(['When the Jungle Temple is not present'])
    expect(Object.fromEntries(captionConditions(parseDropListing(PLANTERA), (c) => REGISTERED[c]))).toEqual({
      'Lihzahrd Brick': { conditions: ['jungle-temple-absent'] },
      'Forbidden Lihzahrd Brick Wall': { conditions: ['jungle-temple-absent'] },
      'Lihzahrd Altar': { conditions: ['jungle-temple-absent'] },
      Picksaw: { conditions: ['jungle-temple-absent'] },
    })
    // a registry without the caption: nothing (an unregistered caption is no condition)
    expect(captionConditions(parseDropListing(PLANTERA), conditionFor).size).toBe(0)
  })

  it('the registered captions and notes are the shipped conditions overlay\'s', () => {
    const matchers = conditionMatchers(loadConditionsOverlay())
    for (const [text, id] of Object.entries(REGISTERED)) expect(matchers.dropCaption.get(text)?.id, text).toBe(id)
    // the Cargo rows of those items carry the caption as a note pointing at it: the same condition
    expect(matchers.dropNote.get('when the Jungle Temple is not present; see conditions')?.id).toBe('jungle-temple-absent')
  })

  it('an item listed both under a registered caption and outside it is ambiguous (the caller makes its conditions Unknown)', () => {
    const html = `<ul class="drops items">${caption('Only in Corrupt worlds')}${item('Demonite Ore', 'group')}<li class="groupend"></li>${item('Demonite Ore', '')}</ul>`
    expect(captionConditions(parseDropListing(html), conditionFor).get('Demonite Ore')).toEqual({ ambiguous: ['Only in Corrupt worlds', '(no caption)'] })
  })
})
