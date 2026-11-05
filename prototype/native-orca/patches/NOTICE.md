# Native compatibility patches

These patches contain excerpts of OrcaSlicer source, copyright its respective
contributors, and are distributed under the GNU Affero General Public License
version 3. See [LICENSE.OrcaSlicer.txt](LICENSE.OrcaSlicer.txt), copied unchanged
from the [pinned native source](https://github.com/lewis252310/OrcaSlicer/blob/d4da6e4d0efd6dc490e02147741a756a2ed98143/LICENSE.txt).

`clang-fin-vector.patch` evaluates the existing condition through explicit
assignments to compile with Apple Clang 21 and Eigen 5.0.1.
`fin-tests-api.patch` updates only the native test harness's Eigen expression
and configuration API calls. Neither patch changes test assertions.

The independently written procedural generators and validation tooling outside
this directory remain covered by the Support Fins repository license. Native
application binaries and dependency sources are not included in this contribution.
