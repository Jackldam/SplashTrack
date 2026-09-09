import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { listPoolsForPrincipal } from "@/modules/sessions";

import { guarded, requireSignedIn } from "../access";
import { createPoolAction } from "../actions";

/**
 * The club's pools and lanes — *Baden en banen*.
 *
 * D-175: these are FACILITIES owned by the `sessions` module, never
 * `OrganizationUnit`s and never authorization scopes. So this screen has no
 * reach filtering and nothing to reach-filter: a pool is a name and a length.
 * *"A lane is where a lesson happens, not who may read a child's record."*
 *
 * It is still permission-guarded, at `planning.read` on the organisation. A page
 * that renders without any check has disclosed that this installation exists and
 * what facilities it has, before any service was called — which is the failure
 * `access.tsx` describes.
 */
export default async function PoolsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const [t, query, session] = await Promise.all([
    getTranslations(),
    searchParams,
    requireSignedIn(),
  ]);

  const result = await guarded(() =>
    listPoolsForPrincipal({ principal: { personId: session.person.id } }),
  );

  if (!result.ok) {
    return (
      <main className="container py-5">
        <h1>{t("pools.title")}</h1>
        <div className="alert alert-warning mt-4" role="alert">
          <h2 className="h5">{t("groups.denied.title")}</h2>
          <p className="mb-0">
            {t("groups.denied.explanation", { permission: result.permission })}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="container py-5">
      <nav aria-label="kruimelpad" className="mb-3">
        <Link href="/groups">{t("groups.title")}</Link>
      </nav>

      <h1>{t("pools.title")}</h1>
      <p className="text-muted">{t("pools.subtitle")}</p>

      {query.error ? (
        <div className="alert alert-danger" role="alert">
          {t(`groups.errors.${query.error}` as "groups.errors.validation")}
        </div>
      ) : null}
      {query.saved ? (
        <div className="alert alert-success" role="status">
          {t(`groups.saved.${query.saved}` as "groups.saved.group")}
        </div>
      ) : null}

      {result.value.length === 0 ? (
        <p className="text-muted">{t("pools.empty")}</p>
      ) : (
        <ul className="list-group">
          {result.value.map((pool) => (
            <li className="list-group-item" key={pool.id}>
              <strong>{pool.name}</strong>
              {pool.lengthMetres ? (
                <span className="text-muted"> — {pool.lengthMetres} m</span>
              ) : null}
              <div className="text-muted">
                {pool.lanes.length === 0
                  ? t("pools.noLanes")
                  : t("pools.lanes", {
                      count: pool.lanes.length,
                      names: pool.lanes.map((lane) => lane.name).join(", "),
                    })}
              </div>
            </li>
          ))}
        </ul>
      )}

      <details className="mt-4">
        <summary className="h6">{t("pools.create.title")}</summary>
        <form action={createPoolAction} className="row g-2 mt-2">
          <div className="col-md-6">
            <label className="form-label" htmlFor="poolName">
              {t("pools.fields.name")}
            </label>
            <input
              className="form-control"
              id="poolName"
              name="name"
              required
              maxLength={80}
            />
          </div>
          <div className="col-md-3">
            <label className="form-label" htmlFor="lengthMetres">
              {t("pools.fields.length")}
            </label>
            <input
              className="form-control"
              id="lengthMetres"
              name="lengthMetres"
              type="number"
              min={1}
              max={100}
            />
          </div>
          <div className="col-12">
            <button className="btn btn-primary btn-sm" type="submit">
              {t("pools.create.submit")}
            </button>
          </div>
        </form>
      </details>
    </main>
  );
}
