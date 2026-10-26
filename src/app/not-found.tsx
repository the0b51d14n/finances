import Link from "next/link";

export default function NotFound() {
  return (
    <div className="card stack" style={{ maxWidth: 480, margin: "64px auto", textAlign: "center" }}>
      <h1 style={{ fontSize: "1.2rem" }}>Page introuvable</h1>
      <p className="muted">Cet élément n&apos;existe pas ou ne vous appartient pas.</p>
      <div>
        <Link href="/" className="btn btn-primary">
          Retour au tableau de bord
        </Link>
      </div>
    </div>
  );
}
