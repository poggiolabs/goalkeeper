const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

const services = [
  { name: "REST API", url: `${apiUrl}/health` },
  { name: "Documentation", url: "http://localhost:3003/docs" }
];

export function App() {
  return (
    <main>
      <section className="hero">
        <h1>Goalkeeper.</h1>
        <p className="lede">
          Team goals for AI agents.
        </p>
      </section>

      <section aria-labelledby="services-title">
        <h2 id="services-title">Local services</h2>
        <div className="grid">
          {services.map((service) => (
            <a className="card" href={service.url} key={service.name}>
              <span>{service.name}</span>
              <span aria-hidden="true">↗</span>
            </a>
          ))}
        </div>
      </section>
    </main>
  );
}
