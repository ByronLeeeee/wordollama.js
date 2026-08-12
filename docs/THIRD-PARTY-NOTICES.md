# Third-party notices

WordOllama.JS is licensed as a whole under GPL-3.0-only. The following
third-party components retain their own copyright notices and license terms.
Their inclusion does not relicense those components under the project license.

## JavaScript runtime dependencies

The browser bundle directly uses:

| Component | License |
| --- | --- |
| i18next | MIT |
| lucide-react | ISC |
| React and React DOM | MIT |
| react-i18next | MIT |

Their production dependency trees can also include `@babel/runtime`,
`html-parse-stringify`, `scheduler`, and `use-sync-external-store`, all under
permissive licenses. Exact versions are locked in
`officejs/apps/addin/package-lock.json`.

`packaging/package-addin.ps1` generates `legal/THIRD-PARTY-LICENSES.txt` from
the installed production dependency tree. That generated file contains the
actual license texts and must remain with redistributed frontend or desktop
packages.

## Build and development dependencies

The source tree uses TypeScript (Apache-2.0), Vite and Tailwind CSS (MIT),
daisyUI (MIT), Microsoft Office Add-in developer tools (MIT), React type
definitions (MIT), and resvg-js (MPL-2.0) to build and validate the product.
They are development inputs and are not copied into the browser bundle merely
because they appear in `package-lock.json`. Consult the locked package metadata
before redistributing any of those tools themselves.

## Self-contained .NET runtime

Desktop Bridge release archives are published as self-contained .NET 8
applications. The .NET runtime and its native components are therefore bundled
with the executable. `packaging/publish-bridge.ps1` copies the matching SDK's
`LICENSE.txt` and `ThirdPartyNotices.txt` into `legal/dotnet/`; those files must
remain with redistributed Bridge and installer packages.

The WordOllama .NET projects currently have no external NuGet `PackageReference`
dependencies. If one is added, this notice and the package-generation checks
must be updated before release.

## External platform components and services

Microsoft Word, Office.js, WebView2, WPS Office, Ollama, model providers, search
services, OAuth providers, and user-configured MCP servers are external
components or services. They are not relicensed by this repository. Office.js
is loaded from Microsoft's required CDN when the add-in runs; it is not included
in the local application bundle.

## Project artwork

The WordOllama.JS icons and artwork stored in this repository are original
project assets and are distributed under GPL-3.0-only unless a nearby notice
states otherwise.
