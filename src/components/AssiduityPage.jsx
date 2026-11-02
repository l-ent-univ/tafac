import ServiceNotice from './ServiceNotice'

// « Assiduité »: the student's attendance (absences, lateness), to come.
// For now the page's tinted top with its title, as « Mes notes » has it, and
// nothing under it.
function AssiduityPage() {
  return (
    <section className="assiduity-page w-full grid gap-4 pt-4 px-6 pb-6 4xl:pt-5 max-md:px-3 max-md:pt-3 max-md:pb-5 max-md:gap-3" aria-labelledby="assiduity-page-title">
      {/* On a phone it tops the screen (no app top bar here), a little more
          room above. */}
      <div className="page-top-band grid gap-5 -mx-6 -mt-4 px-6 pt-4 pb-6 4xl:-mt-5 4xl:pt-5 max-md:-mx-3 max-md:-mt-3 max-md:gap-4 max-md:px-3 max-md:pt-5 max-md:pb-4">
        {/* The university's outage notice, as on every tab. */}
        <ServiceNotice />
        <h1 id="assiduity-page-title" className="m-0 leading-[1.15] text-2xl font-bold max-md:flex max-md:min-h-10 max-md:items-center max-md:text-[26px] max-md:tracking-[-0.01em]">Assiduité</h1>
      </div>
    </section>
  )
}

export default AssiduityPage
