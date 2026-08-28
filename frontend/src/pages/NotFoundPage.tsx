import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <section className="heading-row" style={{ display: 'block' }}>
      <div className="eyebrow">404</div>
      <h1>Page not found</h1>
      <p className="heading-sub">
        That route is not part of the architecture workspace.{' '}
        <Link to="/">Back to the plan</Link>.
      </p>
    </section>
  );
}