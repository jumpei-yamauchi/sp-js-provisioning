import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Taxonomy } from '../../src/handlers/taxonomy'
import { ProvisioningContext } from '../../src/provisioningcontext'
import { ITaxonomy, ITermSet } from '../../src/schema'

const globals: any = globalThis
globals.SP = {
  Guid: class {
    constructor(private value: string) {}
    public toString() {
      return this.value
    }
  }
}

const termSetDef: ITermSet = {
  Id: 'f1e2d3c4-5678-490a-bcde-1234567890ab',
  Name: 'Categories',
  Description: 'Local categories',
  IsOpenForTermCreation: false,
  Terms: [
    {
      Id: 'a1b2c3d4-5678-490a-bcde-1234567890ab',
      Name: 'Internal',
      SortOrder: 2,
      CustomProperties: { Category: 'Internal' }
    },
    {
      Id: 'b1b2c3d4-5678-490a-bcde-1234567890ab',
      Name: 'External',
      SortOrder: 1
    }
  ]
}

class FakeTaxonomy extends Taxonomy {
  public site = { id: 'containing-site-collection' }
  public siteGroupCalls: any[][] = []
  public groupLookups: string[] = []
  public storeSetLookups: string[] = []
  public localSetLookups: string[] = []
  public createdGroups: any[][] = []
  public createdSets: any[][] = []
  public createdTerms: any[][] = []
  public properties: Record<string, string> = {}
  public description: string
  public open: boolean
  public sortOrder: string
  public commits = 0
  public queryError?: Error
  public groupIsNull = false
  private groupExists = false
  private sets = new Set<string>()
  private terms = new Set<string>()
  private loaded: any
  private group: any = {
    get_serverObjectIsNull: () => this.groupIsNull,
    get_termSets: () => ({
      getById: (id: SP.Guid) => {
        this.localSetLookups.push(id.toString())
        return this.getSet(id)
      }
    }),
    createTermSet: (name: string, id: SP.Guid, lcid: number) => {
      this.createdSets.push([name, id.toString(), lcid])
      this.sets.add(id.toString())
      return this.getSet(id)
    }
  }

  private store = {
    get_defaultLanguage: () => 1033,
    getSiteCollectionGroup: (site: SP.Site, create: boolean) => {
      this.siteGroupCalls.push([site, create])
      return this.group
    },
    getGroup: (id: SP.Guid) => {
      this.groupLookups.push(id.toString())
      return {
        ...this.group,
        get_serverObjectIsNull: () => !this.groupExists
      }
    },
    createGroup: (name: string, id: SP.Guid) => {
      this.createdGroups.push([name, id.toString()])
      this.groupExists = true
      return this.group
    },
    getTermSet: (id: SP.Guid) => {
      this.storeSetLookups.push(id.toString())
      return this.getSet(id)
    },
    getTerm: (id: SP.Guid) => ({
      get_serverObjectIsNull: () => !this.terms.has(id.toString())
    }),
    commitAll: () => this.commits++
  }

  constructor() {
    super({})
  }

  private getSet(id: SP.Guid): any {
    return {
      get_serverObjectIsNull: () => !this.sets.has(id.toString()),
      set_description: (value: string) => (this.description = value),
      set_isOpenForTermCreation: (value: boolean) => (this.open = value),
      set_customSortOrder: (value: string) => (this.sortOrder = value),
      createTerm: (name: string, lcid: number, termId: SP.Guid) => {
        this.createdTerms.push([name, lcid, termId.toString()])
        this.terms.add(termId.toString())
        return {
          setCustomProperty: (key: string, value: string) =>
            (this.properties[key] = value)
        }
      }
    }
  }

  protected initializeJsom(): Promise<any> {
    return Promise.resolve({
      defaultTermStore: this.store,
      jsomContext: {
        clientContext: {
          get_site: () => this.site,
          load: (object: any) => (this.loaded = object)
        }
      }
    })
  }

  protected executeQuery(): Promise<void> {
    return this.queryError && this.loaded === this.group
      ? Promise.reject(this.queryError)
      : Promise.resolve()
  }

  public provision(taxonomy: ITaxonomy): Promise<void> {
    const context = new ProvisioningContext()
    context.web = { ServerRelativeUrl: '/sites/demo/subweb' }
    return this.ProvisionObjects(undefined, taxonomy, context)
  }
}

describe('Taxonomy scopes', () => {
  it('creates local sets and terms without a template group, preserving settings and IDs', async () => {
    const handler = new FakeTaxonomy()
    await handler.provision({
      Scope: 'SiteCollection',
      TermSets: [termSetDef]
    })

    assert.deepEqual(handler.siteGroupCalls, [[handler.site, true]])
    assert.deepEqual(handler.groupLookups, [])
    assert.deepEqual(handler.createdGroups, [])
    assert.deepEqual(handler.storeSetLookups, [])
    assert.deepEqual(handler.localSetLookups, [termSetDef.Id])
    assert.deepEqual(handler.createdSets, [['Categories', termSetDef.Id, 1033]])
    assert.equal(handler.description, termSetDef.Description)
    assert.equal(handler.open, false)
    assert.deepEqual(handler.createdTerms, [
      ['Internal', 1033, termSetDef.Terms[0].Id],
      ['External', 1033, termSetDef.Terms[1].Id]
    ])
    assert.deepEqual(handler.properties, { Category: 'Internal' })
    assert.equal(
      handler.sortOrder,
      `${termSetDef.Terms[1].Id}:${termSetDef.Terms[0].Id}`
    )
    assert.equal(handler.commits, 3)
  })

  it('reuses the site collection group, sets and terms on reapplication and ignores TermGroup', async () => {
    const handler = new FakeTaxonomy()
    const taxonomy: ITaxonomy = {
      Scope: 'SiteCollection',
      TermGroup: { Id: 'ignored', Name: 'Ignored' },
      TermSets: [termSetDef]
    }
    await handler.provision(taxonomy)
    await handler.provision(taxonomy)
    assert.equal(handler.siteGroupCalls.length, 2)
    assert.deepEqual(handler.createdGroups, [])
    assert.equal(handler.createdSets.length, 1)
    assert.equal(handler.createdTerms.length, 2)
  })

  for (const Scope of [undefined, 'TermStore'] as const) {
    it(`preserves named term-store creation with scope ${Scope}`, async () => {
      const handler = new FakeTaxonomy()
      await handler.provision({
        Scope,
        TermGroup: {
          Id: 'c1b2c3d4-5678-490a-bcde-1234567890ab',
          Name: 'Shared'
        },
        TermSets: [termSetDef]
      })
      assert.deepEqual(handler.siteGroupCalls, [])
      assert.deepEqual(handler.createdGroups, [
        ['Shared', 'c1b2c3d4-5678-490a-bcde-1234567890ab']
      ])
      assert.deepEqual(handler.storeSetLookups, [termSetDef.Id])
      assert.deepEqual(handler.localSetLookups, [])
    })
  }

  it('rejects missing TermGroup in the default scope', async () => {
    await assert.rejects(
      new FakeTaxonomy().provision({ TermSets: [] }),
      /TermGroup is required/
    )
  })

  it('rejects unsupported scopes from JSON templates', async () => {
    await assert.rejects(
      new FakeTaxonomy().provision(
        JSON.parse('{"Scope":"Invalid","TermSets":[]}')
      ),
      /Unsupported taxonomy scope/
    )
  })

  it('propagates site collection group query failures without creating sets', async () => {
    const handler = new FakeTaxonomy()
    handler.queryError = new Error('Access denied')
    await assert.rejects(
      handler.provision({ Scope: 'SiteCollection', TermSets: [termSetDef] }),
      /Access denied/
    )
    assert.deepEqual(handler.createdSets, [])
  })

  it('rejects a null site collection group', async () => {
    const handler = new FakeTaxonomy()
    handler.groupIsNull = true
    await assert.rejects(
      handler.provision({ Scope: 'SiteCollection', TermSets: [termSetDef] }),
      /No site collection term group/
    )
  })
})
