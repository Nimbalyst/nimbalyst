import { evaluateCalcSheet } from '../evaluator';
import { parseCalcSheetDocument } from '../parser';

describe('Calc Sheets parser and evaluator', () => {
  it('classifies constants vs formulas and evaluates dependencies', () => {
    const parsed = parseCalcSheetDocument([
      'price = 149 USD',
      'seats = 120',
      'mrr = price * seats -> currency(USD, 0)',
    ].join('\n'));

    const evaluated = evaluateCalcSheet(parsed.lines, parsed.frontmatter);
    const price = evaluated.bindings.get('price');
    const mrr = evaluated.bindings.get('mrr');

    expect(price?.classification).toBe('constant');
    expect(mrr?.classification).toBe('formula');
    expect(mrr?.formatted).toBe('$17,880');
  });

  it('parses frontmatter units and fx rates', () => {
    const parsed = parseCalcSheetDocument([
      '---',
      'baseCurrency: USD',
      'units:',
      '  - customer',
      'fx:',
      '  rates:',
      '    EUR: 1.08 USD',
      '---',
      '',
      'mrr = 100 USD',
      'mrr_eur = to(mrr, EUR) -> currency(EUR, 2)',
      'customers = 4 customer',
    ].join('\n'));

    const evaluated = evaluateCalcSheet(parsed.lines, parsed.frontmatter);
    expect(evaluated.bindings.get('mrr_eur')?.formatted).toBe('€92.59');
    expect(evaluated.bindings.get('customers')?.formatted).toContain('customer');
  });

  it('flags circular dependencies', () => {
    const parsed = parseCalcSheetDocument([
      'a = b + 1',
      'b = a + 1',
    ].join('\n'));

    const evaluated = evaluateCalcSheet(parsed.lines, parsed.frontmatter);
    expect(evaluated.bindings.get('a')?.error).toContain('Circular dependency');
    expect(evaluated.bindings.get('b')?.formatted).toBe('ERR');
  });

  it('evaluates assertions', () => {
    const parsed = parseCalcSheetDocument([
      'gross_profit = 80',
      'mrr = 100',
      'gross_margin = gross_profit / mrr -> percent(1)',
      'assert gross_profit / mrr > 0.5',
    ].join('\n'));

    const evaluated = evaluateCalcSheet(parsed.lines, parsed.frontmatter);
    expect(evaluated.bindings.get('gross_margin')?.formatted).toBe('80.0%');
    expect(evaluated.lineOutputs[3]).toBe('ASSERT OK');
  });
});
