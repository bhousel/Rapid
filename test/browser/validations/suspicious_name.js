describe('validationSuspiciousName', () => {

  class MockNsi {
    constructor() {
      this.status = 'ok';
    }
    isGenericName(tags) {
      const name = tags.name ?? '';
      // simulate global exclude
      if (/^stores?$/.test(name)) return true;
      // simulate category exclude
      if (/^(mini|super)?\s?(market|mart|mercado)( municipal)?$/.test(name)) return true;
      return false;
    }
  }

  class MockLocalizationSystem {
    constructor() {}
    displayLabel(entity)  { return entity.id; }
    t(id)                 { return id; }
  }

  class MockContext {
    constructor() {
      this.viewport = new Rapid.sdk.Viewport();
      this.services = {
        nsi: new MockNsi()
      };
      this.systems = {
        l10n: new MockLocalizationSystem()
      };
    }
  }


  const context = new MockContext();
  const validator = Rapid.validationSuspiciousName(context);

  it('ignores feature with no tags', () => {
    const n = new Rapid.OsmNode(context);
    const issues = validator(n);
    expect(issues).to.have.lengthOf(0);
  });

  it('ignores feature with no name', () => {
    const n = new Rapid.OsmNode(context, { tags: { shop: 'supermarket' }});
    const issues = validator(n);
    expect(issues).to.have.lengthOf(0);
  });

  it('ignores feature with a specific name', () => {
    const n = new Rapid.OsmNode(context, { tags: { shop: 'supermarket', name: 'Lou\'s' }});
    const issues = validator(n);
    expect(issues).to.have.lengthOf(0);
  });

  it('ignores feature with a specific name that includes a generic name', () => {
    const n = new Rapid.OsmNode(context, { tags: { shop: 'supermarket', name: 'Lou\'s Store' }});
    const issues = validator(n);
    expect(issues).to.have.lengthOf(0);
  });

  it('ignores feature matching excludeNamed pattern in name-suggestion-index', () => {
    const n = new Rapid.OsmNode(context, { tags: { shop: 'supermarket', name: 'famiglia cooperativa' }});
    const issues = validator(n);
    expect(issues).to.have.lengthOf(0);
  });

  it('flags feature matching a excludeGeneric pattern in name-suggestion-index', () => {
    const n = new Rapid.OsmNode(context, { tags: { shop: 'supermarket', name: 'super mercado' }});
    const issues = validator(n);
    expect(issues).to.have.lengthOf(1);
    const issue = issues[0];
    expect(issue.type).to.eql('suspicious_name');
    expect(issue.subtype).to.eql('generic_name');
    expect(issue.entityIds).to.have.lengthOf(1);
    expect(issue.entityIds[0]).to.eql(n.id);
  });

  it('flags feature matching a global exclude pattern in name-suggestion-index', () => {
    const n = new Rapid.OsmNode(context, { tags: { shop: 'supermarket', name: 'store' }});
    const issues = validator(n);
    expect(issues).to.have.lengthOf(1);
    const issue = issues[0];
    expect(issue.type).to.eql('suspicious_name');
    expect(issue.subtype).to.eql('generic_name');
    expect(issue.entityIds).to.have.lengthOf(1);
    expect(issue.entityIds[0]).to.eql(n.id);
  });

  it('flags feature with a name that is just a defining tag key', () => {
    const n = new Rapid.OsmNode(context, { tags: { amenity: 'drinking_water', name: 'Amenity' }});
    const issues = validator(n);
    expect(issues).to.have.lengthOf(1);
    const issue = issues[0];
    expect(issue.type).to.eql('suspicious_name');
    expect(issue.subtype).to.eql('generic_name');
    expect(issue.entityIds).to.have.lengthOf(1);
    expect(issue.entityIds[0]).to.eql(n.id);
  });

  it('flags feature with a name that is just a defining tag value', () => {
    const n = new Rapid.OsmNode(context, { tags: { shop: 'red_bicycle_emporium', name: 'Red Bicycle Emporium' }});
    const issues = validator(n);
    expect(issues).to.have.lengthOf(1);
    const issue = issues[0];
    expect(issue.type).to.eql('suspicious_name');
    expect(issue.subtype).to.eql('generic_name');
    expect(issue.entityIds).to.have.lengthOf(1);
    expect(issue.entityIds[0]).to.eql(n.id);
  });

  it('ignores feature with a non-matching `not:name` tag', () => {
    const n = new Rapid.OsmNode(context, { tags: { shop: 'supermarket', name: 'Lou\'s', 'not:name': 'Lous' }});
    const issues = validator(n);
    expect(issues).to.have.lengthOf(0);
  });

  it('flags feature with a matching `not:name` tag', () => {
    const n = new Rapid.OsmNode(context, { tags: { shop: 'supermarket', name: 'Lous', 'not:name': 'Lous' }});
    const issues = validator(n);
    expect(issues).to.have.lengthOf(1);
    const issue = issues[0];
    expect(issue.type).to.eql('suspicious_name');
    expect(issue.subtype).to.eql('not_name');
    expect(issue.entityIds).to.have.lengthOf(1);
    expect(issue.entityIds[0]).to.eql(n.id);
  });

  it('flags feature with a matching a semicolon-separated `not:name` tag', () => {
    const n = new Rapid.OsmNode(context, { tags: { shop: 'supermarket', name: 'Lous', 'not:name': 'Louis\';Lous;Louis\'s' }});
    const issues = validator(n);
    expect(issues).to.have.lengthOf(1);
    const issue = issues[0];
    expect(issue.type).to.eql('suspicious_name');
    expect(issue.subtype).to.eql('not_name');
    expect(issue.entityIds).to.have.lengthOf(1);
    expect(issue.entityIds[0]).to.eql(n.id);
  });

});
