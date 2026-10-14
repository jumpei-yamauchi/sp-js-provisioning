import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const manifest = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8')
)

const pnpPackages = ['@pnp/core', '@pnp/logging', '@pnp/queryable', '@pnp/sp']

describe('package manifest: Git dependency build', () => {
  it('builds during Git dependency preparation and package creation', () => {
    assert.equal(manifest.scripts.prepare, 'npm run build')
    assert.equal(manifest.scripts.prepack, 'npm run build')
  })

  it('ships the directory containing both declared entrypoints', () => {
    assert.equal(manifest.main, './lib/index.js')
    assert.equal(manifest.types, './lib/index.d.ts')
    assert.ok(manifest.files.includes('lib'))
    assert.ok(manifest.devDependencies.typescript)
  })
})

describe('package manifest: PnPjs single instance', () => {
  it('declares the PnPjs packages as peers, not as hard dependencies', () => {
    // The published typings expose `IWeb` (a class with protected members) in
    // the WebProvisioner constructor, so two physically distinct @pnp/sp copies
    // are not structurally assignable. Peer dependencies make the package
    // manager - not a README note - enforce the single instance.
    for (const name of pnpPackages) {
      assert.equal(
        manifest.dependencies[name],
        undefined,
        `${name} must not be a runtime dependency`
      )
      assert.equal(
        manifest.peerDependencies[name],
        '^4.21.0',
        `${name} must be a peer dependency`
      )
      assert.ok(
        manifest.devDependencies[name],
        `${name} must stay a devDependency so build and tests resolve it`
      )
    }
  })
})
