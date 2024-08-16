using Microsoft.AspNetCore.Identity;
using System.ComponentModel.DataAnnotations;


namespace SplashTrackWebApp.Areas.Identity.Data
{
    public class SplashTrackUser : IdentityUser
    {
        // Basic User Information
        [Required]
        [PersonalData]
        public required string FirstName { get; set; }
        [PersonalData]
        public string? MiddleName { get; set; }
        [Required]
        [PersonalData]
        public required string LastName { get; set; }
        [Required]
        [PersonalData]
        public required DateOnly DateOfBirth { get; set; }

    }

}
