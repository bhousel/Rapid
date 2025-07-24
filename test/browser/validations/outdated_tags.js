describe('validationOutdatedTags', () => {

  class MockLocalizationSystem {
    constructor() {}
    displayLabel(entity)  { return entity.id; }
    t(id)                 { return id; }
  }

  class MockContext {
    constructor() {
      this.sequences = {};
      this.viewport = new Rapid.sdk.Viewport();
      this.services = {};
      this.systems = {
        assets:     new Rapid.AssetSystem(this),
        l10n:       new MockLocalizationSystem(this),
        locations:  new Rapid.LocationSystem(this),
        presets:    new Rapid.PresetSystem(this)
      };
    }
    next(which) {
      let num = this.sequences[which] || 0;
      return this.sequences[which] = ++num;
    }
  }

  const context = new MockContext();
  const validator = Rapid.validationOutdatedTags(context);


  it('has no errors on good tags', () => {
    const w = new Rapid.OsmWay(context, { tags: { highway: 'unclassified' }});
    const g = new Rapid.Graph(context, [w]);
    const issues = validator(w, g);
    expect(issues).to.have.lengthOf(0);
  });

  it('flags deprecated tag with replacement', () => {
    const w = new Rapid.OsmWay(context, { tags: { highway: 'ford' }});
    const g = new Rapid.Graph(context, [w]);
    const issues = validator(w, g);
    expect(issues).to.have.lengthOf(1);
    const issue = issues[0];
    expect(issue.type).to.eql('outdated_tags');
    expect(issue.subtype).to.eql('deprecated_tags');
    expect(issue.severity).to.eql('warning');
    expect(issue.entityIds).to.have.lengthOf(1);
    expect(issue.entityIds[0]).to.eql(w.id);
  });

  it('flags deprecated tag with no replacement', () => {
    const w = new Rapid.OsmWay(context, { tags: { highway: 'no' }});
    const g = new Rapid.Graph(context, [w]);
    const issues = validator(w, g);
    expect(issues).to.have.lengthOf(1);
    const issue = issues[0];
    expect(issue.type).to.eql('outdated_tags');
    expect(issue.subtype).to.eql('deprecated_tags');
    expect(issue.severity).to.eql('warning');
    expect(issue.entityIds).to.have.lengthOf(1);
    expect(issue.entityIds[0]).to.eql(w.id);
  });

  it('ignores multipolygon tagged on the relation', () => {
    const w = new Rapid.OsmWay(context);
    const r = new Rapid.OsmRelation(context, {
      tags: { building: 'yes', type: 'multipolygon' },
      members: [{ id: w.id, role: 'outer' }]
    });
    const g = new Rapid.Graph(context, [w, r]);
    const wIssues = validator(w, g);
    const rIssues = validator(r, g);
    expect(wIssues).to.have.lengthOf(0);
    expect(rIssues).to.have.lengthOf(0);
  });

  it('flags multipolygon tagged on the outer way', () => {
    const w = new Rapid.OsmWay(context, { tags: { building: 'yes' } });
    const r = new Rapid.OsmRelation(context, {
      tags: { type: 'multipolygon' },
      members: [{ id: w.id, role: 'outer' }]
    });
    const g = new Rapid.Graph(context, [w, r]);
    const wIssues = validator(w, g);
    const rIssues = validator(r, g);
    expect(rIssues).to.have.lengthOf(0);
    expect(wIssues).to.have.lengthOf(1);

    const issue = wIssues[0];
    expect(issue.type).to.eql('outdated_tags');
    expect(issue.subtype).to.eql('old_multipolygon');
    expect(issue.entityIds).to.have.lengthOf(2);
    expect(issue.entityIds[0]).to.eql(w.id);
    expect(issue.entityIds[1]).to.eql(r.id);
  });

});
