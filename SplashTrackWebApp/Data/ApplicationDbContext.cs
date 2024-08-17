using System;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using SplashTrackWebApp.Areas.Identity.Data;

namespace SplashTrackWebApp.Data
{
    public class ApplicationDbContext : IdentityDbContext<SplashTrackUser>
    {
        public ApplicationDbContext(DbContextOptions<ApplicationDbContext> options)
            : base(options)
        {
        }

    }
}
