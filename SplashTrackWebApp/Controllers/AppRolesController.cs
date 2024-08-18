using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using SplashTrackWebApp.Areas.Identity.Data;

namespace SplashTrackWebApp.Controllers
{
    public class AppRolesController : Controller
    {
        private readonly RoleManager<IdentityRole> _roleManager;

        public AppRolesController(RoleManager<IdentityRole> roleManager)
        {
            _roleManager = roleManager;
        }

        // List all roles in the application
        public IActionResult Index()
        {
            var roles = _roleManager.Roles;
            return View();
        }

        // Create a new role
        [Authorize]
        public IActionResult Create()
        {
            return View();
        }

        [Authorize]
        [HttpPost]
        public async Task<IActionResult> Create(IdentityRole role)
        {
            if (!ModelState.IsValid)
            {
                return View(role);
            }

            await _roleManager.CreateAsync(role);
            return RedirectToAction("Index");
        }
        
    }
}
