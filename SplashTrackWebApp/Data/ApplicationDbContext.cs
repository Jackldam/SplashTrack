using System;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using SplashTrackWebApp.Areas.Identity.Data;
using SplashTrackWebApp.Models;

namespace SplashTrackWebApp.Data
{
    public class ApplicationDbContext : IdentityDbContext<SplashTrackUser>
    {
        public ApplicationDbContext(DbContextOptions<ApplicationDbContext> options)
            : base(options)
        {
        }

        public DbSet<Student> Students { get; set; }
    }
}
