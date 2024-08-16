using Microsoft.AspNetCore.Identity;


namespace SplashTrackWebApp.Areas.Identity.Data
{
    public class SplashTrackUser : IdentityUser
    {
        // Basic User Information
        public required string FirstName { get; set; }
        public string? MiddleName { get; set; }
        public required string LastName { get; set; }
        public required DateOnly DateOfBirth { get; set; }

    }

}
