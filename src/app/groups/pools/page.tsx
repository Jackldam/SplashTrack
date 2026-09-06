import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { listPoolsForPrincipal } from "@/modules/sessions";

import { guarded, requireSignedIn } from "../access";
import {
  createLaneAction,
  createPoolAction,
  updateLaneAction,
  updatePoolAction,
} from "../actions";

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
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE READ THAT GOT YOU HERE IS NOT THE CHECK THAT LETS YOU WRITE
 *
 * This page renders on `planning.read`, and every form on it writes on
 * `planning.manage`. The forms render for anyone who can read — the same choice
 * §1.1 rule 1 makes for the landing page's module links — and each write is
 * refused at the service, with a denial that names the missing permission.
 *
 * That is deliberate. Hiding a form from a volunteer who lacks the grant
 * teaches them the application has no such feature; showing it and refusing
 * tells them there is a permission somebody can give them. What would be a
 * defect is a form that renders AND writes because this page's read check was
 * mistaken for a write check — which is why `updatePool` and `updateLane` guard
 * on their own rather than trusting the page that rendered them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE POOL IS ONE DISCLOSURE, AND EVERYTHING ABOUT IT IS INSIDE
 *
 * Correcting a pool, adding a lane and correcting a lane all live under the
 * pool they belong to rather than on an edit screen per row. On a phone at the
 * poolside that is one tap to open the thing you are looking at and no
 * navigation at all to fix it — and with every pool closed the list still fits
 * on a screen.
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
        <nav aria-label="kruimelpad" className="mb-3">
          <Link href="/groups">{t("groups.title")}</Link>
        </nav>
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
              <details>
                <summary>
                  <strong>{pool.name}</strong>
                  {pool.lengthMetres ? (
                    <span className="text-muted"> — {pool.lengthMetres} m</span>
                  ) : null}
                  {!pool.active ? (
                    <span className="badge text-bg-secondary ms-2">
                      {t("pools.inactive")}
                    </span>
                  ) : null}
                  <div className="text-muted">
                    {pool.lanes.length === 0
                      ? t("pools.noLanes")
                      : t("pools.lanes", {
                          count: pool.lanes.length,
                          names: pool.lanes.map((lane) => lane.name).join(", "),
                        })}
                  </div>
                </summary>

                {/* ── correcting the pool ───────────────────────────────── */}
                <h2 className="h6 mt-3">{t("pools.edit.title")}</h2>
                <form action={updatePoolAction} className="row g-2">
                  <input type="hidden" name="poolId" value={pool.id} />
                  <div className="col-md-6">
                    <label
                      className="form-label"
                      htmlFor={`poolName-${pool.id}`}
                    >
                      {t("pools.fields.name")}
                    </label>
                    <input
                      className="form-control"
                      id={`poolName-${pool.id}`}
                      name="name"
                      defaultValue={pool.name}
                      required
                      maxLength={80}
                    />
                  </div>
                  <div className="col-md-3">
                    <label
                      className="form-label"
                      htmlFor={`poolLength-${pool.id}`}
                    >
                      {t("pools.fields.length")}
                    </label>
                    <input
                      className="form-control"
                      id={`poolLength-${pool.id}`}
                      name="lengthMetres"
                      type="number"
                      min={1}
                      max={100}
                      defaultValue={pool.lengthMetres ?? ""}
                    />
                  </div>
                  <div className="col-md-3 form-check mt-4 ms-2">
                    <input
                      className="form-check-input"
                      id={`poolActive-${pool.id}`}
                      name="active"
                      type="checkbox"
                      defaultChecked={pool.active}
                    />
                    <label
                      className="form-check-label"
                      htmlFor={`poolActive-${pool.id}`}
                    >
                      {t("pools.fields.active")}
                    </label>
                  </div>
                  <div className="col-12">
                    <button className="btn btn-primary btn-sm" type="submit">
                      {t("pools.edit.submit")}
                    </button>
                    <span className="form-text ms-3">
                      {t("pools.edit.note")}
                    </span>
                  </div>
                </form>

                {/* ── the lanes in it ───────────────────────────────────── */}
                <h2 className="h6 mt-4">{t("pools.lane.title")}</h2>
                {pool.lanes.length === 0 ? (
                  <p className="text-muted">{t("pools.noLanes")}</p>
                ) : (
                  <ul className="list-group list-group-flush mb-2">
                    {pool.lanes.map((lane, index) => (
                      <li className="list-group-item px-0" key={lane.id}>
                        <form action={updateLaneAction} className="row g-2">
                          <input type="hidden" name="laneId" value={lane.id} />
                          <div className="col-7 col-md-5">
                            <label
                              className="form-label visually-hidden"
                              htmlFor={`laneName-${lane.id}`}
                            >
                              {t("pools.lane.name")}
                            </label>
                            <input
                              className="form-control"
                              id={`laneName-${lane.id}`}
                              name="name"
                              defaultValue={lane.name}
                              required
                              maxLength={40}
                            />
                          </div>
                          <div className="col-5 col-md-3">
                            <label
                              className="form-label visually-hidden"
                              htmlFor={`laneSequence-${lane.id}`}
                            >
                              {t("pools.lane.sequence")}
                            </label>
                            {/* The rendered position, not a stored value:
                                `PoolView` returns lanes already ordered, so the
                                number in the box is what the list shows. */}
                            <input
                              className="form-control"
                              id={`laneSequence-${lane.id}`}
                              name="sequence"
                              type="number"
                              min={0}
                              max={999}
                              defaultValue={index}
                            />
                          </div>
                          <div className="col-md-4">
                            <button
                              className="btn btn-outline-secondary btn-sm"
                              type="submit"
                            >
                              {t("pools.lane.save")}
                            </button>
                          </div>
                        </form>
                      </li>
                    ))}
                  </ul>
                )}

                {/* ── adding one ────────────────────────────────────────── */}
                <form action={createLaneAction} className="row g-2 mt-2">
                  <input type="hidden" name="poolId" value={pool.id} />
                  <div className="col-7 col-md-5">
                    <label
                      className="form-label"
                      htmlFor={`newLaneName-${pool.id}`}
                    >
                      {t("pools.lane.name")}
                    </label>
                    <input
                      className="form-control"
                      id={`newLaneName-${pool.id}`}
                      name="name"
                      required
                      maxLength={40}
                      placeholder={t("pools.lane.namePlaceholder")}
                    />
                  </div>
                  <div className="col-5 col-md-3">
                    <label
                      className="form-label"
                      htmlFor={`newLaneSequence-${pool.id}`}
                    >
                      {t("pools.lane.sequence")}
                    </label>
                    {/* Defaulted to the end of the list: a lane's order is a
                        presentation detail nobody should have to think about
                        to put "baan 4" after "baan 3". */}
                    <input
                      className="form-control"
                      id={`newLaneSequence-${pool.id}`}
                      name="sequence"
                      type="number"
                      min={0}
                      max={999}
                      defaultValue={pool.lanes.length}
                    />
                  </div>
                  <div className="col-md-4">
                    <button className="btn btn-primary btn-sm" type="submit">
                      {t("pools.lane.add")}
                    </button>
                  </div>
                </form>
              </details>
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
