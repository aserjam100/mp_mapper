import { Link } from 'react-router-dom';
import { RatingPill } from '../components/bits';
import { STATIC_SITE } from '../lib/api';

export function AboutPage() {
  return (
    <div className="prose">
      <h1>How to use</h1>

      <h2>What this tool does</h2>
      <p>
        It shows <b>where each curriculum objective is taught in our products</b>. The curricula are Singapore, Australia and the
        Philippines. The products are PINE, PR1ME Australia and PR1ME PH.
      </p>

      <h2>Quick start</h2>
      <ol>
        <li>
          Open <Link to="/">Curricula</Link> and click a curriculum.
        </li>
        <li>You’ll see a grid: one row per objective, and one column per product. Each cell shows the best lesson for that objective.</li>
        <li>Click an objective to see every lesson it maps to, with notes and history.</li>
      </ol>

      <h2>What the colours mean</h2>
      <table className="legend">
        <tbody>
          <tr>
            <td><RatingPill rating="covered" /></td>
            <td>The lesson fully teaches it.</td>
          </tr>
          <tr>
            <td><RatingPill rating="check" /></td>
            <td>The lesson partly teaches it. Read the note to see what differs.</td>
          </tr>
          <tr>
            <td><RatingPill rating="not_found" /></td>
            <td>Someone looked and found no real match.</td>
          </tr>
          <tr>
            <td><RatingPill rating={null} /></td>
            <td>Not mapped yet.</td>
          </tr>
        </tbody>
      </table>
      <p>
        <span className="s-approved">Approved</span> mappings have been signed off by a person.{' '}
        <span className="s-proposed">Proposed</span> mappings are suggestions waiting for review.
      </p>

      <h2>The pages</h2>
      <ul>
        <li>
          <Link to="/">Curricula</Link>: an overview of each curriculum and how much of it is mapped.
        </li>
        <li>
          <b>Coverage</b> (click a curriculum): the grid of objectives × products. Use the filters at the top to narrow it down, and <b>Export CSV</b> to download what you see.
        </li>
        <li>
          <b>Objective</b> (click an objective): all the lessons it maps to, plus matching codes from other curricula.
        </li>
        <li>
          <Link to="/products">Product browser</Link>: start from a book and lesson instead, and see which curriculum codes it covers.
        </li>
        {!STATIC_SITE && (
          <>
            <li>
              <Link to="/new">New curriculum</Link>: upload a spreadsheet of objectives and say which column is which.
            </li>
            <li>
              <Link to="/runs">Matching runs</Link>: find the best lesson for every objective. The first step is free. The optional AI check shows its cost before it starts.
            </li>
          </>
        )}
      </ul>

      <h2>Good to know</h2>
      <ul>
        {STATIC_SITE && <li>This site is a read-only copy. It is updated by hand; the date at the top shows when. Send corrections to the mapping team.</li>}
        <li>The data comes from the four Excel files in <span className="mono">data/source/</span>. The files themselves are never changed.</li>
        <li>PR1ME PH reuses many PINE lessons, so one mapping can count for both products.</li>
        <li>Australian objectives show codes only for now. Their descriptions haven’t been imported yet, so they can’t be matched.</li>
        <li>Matching suggestions are always <span className="s-proposed">proposed</span>. They never replace approved mappings.</li>
      </ul>
    </div>
  );
}
