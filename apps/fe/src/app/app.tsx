import { useEffect, useState } from 'react';
import {
  BE_BASE_URL,
  getBackendHealth,
  getMockLlmHealth,
  type HealthResult,
  type HealthStatus,
} from '../api/be-client';
import './app.css';

const checking: HealthResult = { status: 'checking' };

interface ServiceCardProps {
  eyebrow: string;
  name: string;
  description: string;
  endpoint: string;
  status: HealthStatus;
  detail?: string;
  requestId?: string;
  tone: 'frontend' | 'backend' | 'model';
}

function ServiceCard({
  eyebrow,
  name,
  description,
  endpoint,
  status,
  detail,
  requestId,
  tone,
}: ServiceCardProps) {
  return (
    <article className={`service-card service-card--${tone}`}>
      <div className="service-card__topline">
        <span className="service-card__eyebrow">{eyebrow}</span>
        <span className={`status status--${status}`}>
          <span className="status__dot" aria-hidden="true" />
          {status}
        </span>
      </div>
      <h2>{name}</h2>
      <p>{description}</p>
      <code>{endpoint}</code>
      {detail ? <small className="service-card__detail">{detail}</small> : null}
      {requestId ? (
        <small className="service-card__request">request {requestId}</small>
      ) : null}
    </article>
  );
}

export function App() {
  const [backend, setBackend] = useState<HealthResult>(checking);
  const [mockLlm, setMockLlm] = useState<HealthResult>(checking);
  const [refreshKey, setRefreshKey] = useState(0);
  const [checkedAt, setCheckedAt] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    setBackend(checking);
    setMockLlm(checking);

    Promise.all([
      getBackendHealth(controller.signal),
      getMockLlmHealth(controller.signal),
    ])
      .then(([backendResult, mockLlmResult]) => {
        setBackend(backendResult);
        setMockLlm(mockLlmResult);
        setCheckedAt(new Date().toLocaleTimeString());
      })
      .catch(() => {
        // React StrictMode aborts the first development-only request cycle.
      });

    return () => controller.abort();
  }, [refreshKey]);

  const isChecking =
    backend.status === 'checking' || mockLlm.status === 'checking';

  return (
    <main className="connection-page">
      <header className="connection-header">
        <div>
          <span className="connection-header__step">STEP 04 / LINK CHECK</span>
          <h1>FE to BE connection</h1>
        </div>
        <button
          type="button"
          onClick={() => setRefreshKey((value) => value + 1)}
          disabled={isChecking}
        >
          {isChecking ? 'Checking...' : 'Check again'}
        </button>
      </header>

      <section className="connection-intro" aria-labelledby="connection-title">
        <p className="connection-intro__index">04</p>
        <div>
          <p className="connection-intro__kicker">Runtime connectivity</p>
          <h2 id="connection-title">One path, three running applications.</h2>
          <p>
            The browser talks only to the NestJS backend. The backend owns the
            second hop to the stateless MockLLM service.
          </p>
        </div>
      </section>

      <section className="service-path" aria-label="Service connection status">
        <ServiceCard
          eyebrow="APPLICATION 01"
          name="React FE"
          description="The browser starts both health checks through the configured backend URL."
          endpoint="localhost:4200"
          status="online"
          tone="frontend"
        />

        <div
          className={`connector connector--${backend.status}`}
          aria-label={`FE to BE: ${backend.status}`}
        >
          <span>HTTP</span>
        </div>

        <ServiceCard
          eyebrow="APPLICATION 02"
          name="NestJS BE"
          description="Returns its own health and checks the upstream MockLLM dependency."
          endpoint={`${BE_BASE_URL}/health`}
          status={backend.status}
          detail={backend.detail}
          requestId={backend.requestId}
          tone="backend"
        />

        <div
          className={`connector connector--${mockLlm.status}`}
          aria-label={`BE to MockLLM: ${mockLlm.status}`}
        >
          <span>HTTP</span>
        </div>

        <ServiceCard
          eyebrow="APPLICATION 03"
          name="MockLLM"
          description="The dependency check travels through BE; the browser never calls this service directly."
          endpoint={`${BE_BASE_URL}/health/mock-llm`}
          status={mockLlm.status}
          detail={mockLlm.detail}
          requestId={mockLlm.requestId}
          tone="model"
        />
      </section>

      <footer className="connection-footer">
        <p>
          <span>Configured BE</span>
          <code>{BE_BASE_URL}</code>
        </p>
        <p>
          <span>Last checked</span>
          <strong>{checkedAt ?? 'waiting'}</strong>
        </p>
      </footer>
    </main>
  );
}

export default App;
