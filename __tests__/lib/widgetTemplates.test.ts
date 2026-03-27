import { WIDGET_TEMPLATES } from '../../lib/widgetTemplates'

describe('WIDGET_TEMPLATES', () => {
  it('has at least 3 templates', () => {
    expect(WIDGET_TEMPLATES.length).toBeGreaterThanOrEqual(3)
  })

  it('each template has required fields', () => {
    for (const t of WIDGET_TEMPLATES) {
      expect(t.id).toBeTruthy()
      expect(t.name).toBeTruthy()
      expect(t.emoji).toBeTruthy()
      expect(t.description).toBeTruthy()
      expect(t.widgets.length).toBeGreaterThan(0)
    }
  })

  it('each widget in a template has valid type and dimensions', () => {
    const validTypes = ['photo', 'note', 'song', 'countdown', 'mood', 'sticker']
    for (const t of WIDGET_TEMPLATES) {
      for (const w of t.widgets) {
        expect(validTypes).toContain(w.type)
        expect(w.width).toBeGreaterThan(0)
        expect(w.height).toBeGreaterThan(0)
        expect(typeof w.x).toBe('number')
        expect(typeof w.y).toBe('number')
        expect(w.content).toBeDefined()
      }
    }
  })

  it('template IDs are unique', () => {
    const ids = WIDGET_TEMPLATES.map(t => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
