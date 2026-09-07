/**
 * The CUR parser, which is the only part of the cost check with logic worth
 * pinning. The rest is `aws s3 cp` and arithmetic.
 *
 * These exist because the alternative to a parser here was a dependency, and a
 * dependency with no tests is worse than twelve lines with them.
 */

import { parseCsvLine, aggregateCur } from '../../../scripts/keel/check-aws-cost';

describe('parseCsvLine', () => {
  it('splits a plain row', () => {
    expect(parseCsvLine('a,b,c')).toEqual(['a', 'b', 'c']);
  });

  it('keeps commas that sit inside quotes', () => {
    // Service names contain them: "Amazon Elastic Compute Cloud - Compute"
    // is fine, but tax and marketplace rows are not always so tidy.
    expect(parseCsvLine('a,"b,c",d')).toEqual(['a', 'b,c', 'd']);
  });

  it('unescapes a doubled quote', () => {
    expect(parseCsvLine('a,"say ""hi""",c')).toEqual(['a', 'say "hi"', 'c']);
  });

  it('keeps empty trailing fields', () => {
    // A dropped trailing empty shifts every column index after it.
    expect(parseCsvLine('a,,')).toEqual(['a', '', '']);
  });
});

describe('aggregateCur', () => {
  const header = 'lineItem/ProductCode,product/ProductName,lineItem/UnblendedCost';

  it('sums per service and orders by cost', () => {
    const csv = [
      header,
      'AmazonEC2,Amazon Elastic Compute Cloud,0.10',
      'AmazonS3,Amazon Simple Storage Service,0.05',
      'AmazonEC2,Amazon Elastic Compute Cloud,0.20',
    ].join('\n');

    const { total, byService } = aggregateCur(csv);
    expect(total).toBeCloseTo(0.35);
    // Costs are compared with toBeCloseTo, not toEqual: 0.10 + 0.20 sums to
    // 0.30000000000000004 in binary floating point. The aggregate deliberately
    // does not round -- rounding each service would make the parts stop adding
    // up to the total, which is worse than a long decimal nobody displays.
    expect(byService[0]?.service).toBe('Amazon Elastic Compute Cloud');
    expect(byService[0]?.cost).toBeCloseTo(0.3);
    expect(byService[1]?.service).toBe('Amazon Simple Storage Service');
    expect(byService[1]?.cost).toBeCloseTo(0.05);
  });

  it('reads columns by name, not by position', () => {
    // The CUR schema gains columns over time and the order is not a contract.
    const csv = [
      'lineItem/UnblendedCost,somethingElse,product/ProductName',
      '0.42,x,Amazon Simple Storage Service',
    ].join('\n');
    expect(aggregateCur(csv).total).toBeCloseTo(0.42);
  });

  it('falls back to the product code when a row has no product name', () => {
    // Tax and refund rows arrive this way.
    const csv = [header, 'AWSTax,,0.07'].join('\n');
    expect(aggregateCur(csv).byService[0]?.service).toBe('AWSTax');
  });

  it('labels a row with neither name nor code rather than dropping it', () => {
    // Dropping it would make the per-service breakdown disagree with the
    // total, and a total nobody can reconcile stops being believed.
    const csv = ['lineItem/UnblendedCost', '0.03'].join('\n');
    const { total, byService } = aggregateCur(csv);
    expect(total).toBeCloseTo(0.03);
    expect(byService[0]?.service).toBe('unattributed');
  });

  it('ignores zero-cost rows', () => {
    // Most CUR lines are zero -- usage records for free tier and for services
    // that bill elsewhere. Keeping them would bury the four services that
    // actually cost something.
    const csv = [header, 'AWSGlue,AWS Glue,0', 'AmazonS3,Amazon Simple Storage Service,0.02'].join(
      '\n'
    );
    expect(aggregateCur(csv).byService).toHaveLength(1);
  });

  it('survives a report with a header and no rows', () => {
    // The first delivery of a month looks like this.
    expect(aggregateCur(header)).toEqual({ total: 0, byService: [] });
  });

  it('survives an empty file', () => {
    expect(aggregateCur('')).toEqual({ total: 0, byService: [] });
  });

  it('returns zero when the cost column is absent rather than throwing', () => {
    // A schema change that renames the column must degrade to "no data", not
    // to a crashed monitor.
    expect(aggregateCur('a,b\n1,2').total).toBe(0);
  });
});
